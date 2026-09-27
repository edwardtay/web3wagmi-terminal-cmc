"use client";

import { AsOf, BarCell, InfoHint, Loading, Panel, Section, TableWrap, Th, Unavailable, useSort } from "@/components/ui";
import { pctPlain, usdCompact , NA} from "@/lib/format";
import { useApi } from "@/lib/useApi";
import type { LeveragePayload, LeverageRow } from "@/app/api/leverage/route";

// Compare liquidation value with sampled open interest, filtered and unfiltered.
// The venue universes differ; neither ratio is a fraction of one book closed.
// Legacy API field names retain "cleared" for compatibility.

/** Long liquidated is forced selling, so it reads red. */
const LONG = "var(--neg)";

interface Row extends LeverageRow {
  /** Flagged open interest as a share of what the venue set reports in total. */
  flaggedShare: number | null;
}

export function LeverageCleared() {
  const { data, loading, failed } = useApi<LeveragePayload>("/api/leverage", 900);

  const rows: Row[] = (data?.rows ?? []).map((r) => {
    const reported = r.openInterest + r.flaggedOpenInterest;
    return { ...r, flaggedShare: reported > 0 ? r.flaggedOpenInterest / reported : null };
  });

  const sort = useSort(rows, { key: "clearedFraction" });
  const maxCleared = Math.max(0, ...rows.map((r) => r.clearedFraction ?? 0));

  const totals = data?.totals ?? null;
  const reported = totals ? totals.openInterest + totals.flaggedOpenInterest : 0;
  const flaggedShare = totals && reported > 0 ? totals.flaggedOpenInterest / reported : null;

  return (
    <Section
      title="Liquidations / open interest"
      id="leverage"
      hint="24h liquidations across nine venues divided by sampled open interest across a wider venue set. Compare filtered and unfiltered denominators; this is not the percentage of a matching book that was closed."
    >
      <Panel
        title="Liquidated against open interest, 24h"
        right={<AsOf iso={data?.asOf} staleMs={3 * 3600 * 1000} />}
      >
        {loading && <Loading rows={6} />}

        {!loading && (failed || !data?.ok) && (
          <Unavailable what="Liquidations / open interest" reason={data?.failure} />
        )}

        {!loading && data?.ok && totals && (
          <>
            {flaggedShare != null && (
              <p className="mb-4 text-[11px] leading-relaxed text-[var(--text2)]">
                Across these {data.coverage.priced} coins, venues report{" "}
                <span className="font-mono tabular-nums">{usdCompact(reported)}</span> of open
                interest in the fetched pairs. Pairs flagged by CoinMarketCap for price or volume carry{" "}
                <span className="font-mono tabular-nums">{pctPlain(100 * flaggedShare)}</span> of it,{" "}
                <span className="font-mono tabular-nums">{usdCompact(totals.flaggedOpenInterest)}</span>. Applying those flags to open interest is our assumption, not a CMC verdict on it. The filtered ratio divides by
                the{" "}
                <span className="font-mono tabular-nums">{usdCompact(totals.openInterest)}</span>{" "}
                that is left, and the unfiltered figure is shown beside it so the gap is visible.
                {totals.fundingLongShare != null && (
                  <>
                    {" "}On that same open interest, longs are paying funding on{" "}
                    <span className="font-mono tabular-nums">
                      {pctPlain(100 * totals.fundingLongShare, 0)}
                    </span>{" "}
                    of it and shorts on the rest. An even split would be 50%.
                  </>
                )}
              </p>
            )}

            <p className="mb-4 text-[11px] leading-relaxed text-[var(--text2)]">
              Coverage differs: liquidations cover nine venues; open interest covers the first 100
              pairs per coin across more venues. These ratios compare scale and sensitivity to
              filtering, not the percentage of the same book wiped out.
            </p>

            <TableWrap maxHeight={420}>
              <thead>
                <tr>
                  <Th label="Coin" sortKey="symbol" sort={sort} />
                  <Th
                    label="Liq. / filtered OI"
                    sortKey="clearedFraction"
                    sort={sort}
                    num
                    hint="Nine-venue liquidation value divided by filtered open interest from the fetched pairs across more venues. A comparison ratio, not a fraction of the same book closed."
                  />
                  <Th label="" className="w-24" />
                  <Th
                    label="Liquidated, 24h"
                    sortKey="liquidated24h"
                    sort={sort}
                    num
                    hint="Across the nine derivatives venues CoinMarketCap reports, which is the whole universe of that feed."
                  />
                  <Th
                    label="Filtered OI"
                    sortKey="openInterest"
                    sort={sort}
                    num
                    hint="Summed across the market pairs CoinMarketCap does not flag for price or volume. Pairs it marks outlying, or excludes from price or volume, are counted in the flagged column instead."
                  />
                  <Th
                    label="Unfiltered"
                    sortKey="clearedFractionUnfiltered"
                    sort={sort}
                    num
                    hint="The same liquidation numerator divided by all fetched open interest, including flagged pairs. This still covers only the fetched page."
                  />
                  <Th
                    label="Flagged OI"
                    sortKey="flaggedShare"
                    sort={sort}
                    num
                    hint="Share of fetched open interest on pairs carrying price/volume exclusions or an outlier flag. These flags do not verify or disprove open interest."
                  />
                  <Th
                    label="Longs paying"
                    sortKey="fundingLongShare"
                    sort={sort}
                    num
                    hint="Share of filtered perpetual open interest on venues where funding is positive, so longs pay shorts to hold. Read from the same call as the open interest, across the fetched venues, where the funding desk reads Binance and Hyperliquid. The sign only: the feed omits each venue's settlement period, so the rates themselves are not comparable. Pair counts are long, short and flat."
                  />
                  <Th
                    label="Premium"
                    sortKey="premiumBps"
                    sort={sort}
                    num
                    hint="How far perpetuals trade above their index, in basis points (hundredths of a percent): the open-interest-weighted median across the same filtered pairs. Unlike funding it carries no settlement period, so it compares across venues as it stands. Positive with longs paying is a consistent long lean; the two disagreeing is worth a look. Venues past 1% are treated as a broken index and dropped, and counted under the figure."
                  />
                  <Th
                    label="Pairs read"
                    sortKey="cleanPairs"
                    sort={sort}
                    num
                    hint="Three counts: pairs CoinMarketCap does not flag for price or volume, pairs on this page that carry any open interest, and pairs the coin has in total. The feed pages at 100 sorted by 24h volume, so the denominator covers the top 100 rather than the whole book. For BTC the unread tail held 4.1% more open interest when this was measured."
                  />
                </tr>
              </thead>
              <tbody>
                {sort.sorted.map((r) => (
                  <tr key={r.symbol}>
                    <td className="ident break-words font-semibold">{r.symbol}</td>
                    <td className="num">
                      {r.clearedFraction != null ? pctPlain(100 * r.clearedFraction, 3) : NA}
                    </td>
                    <td className="num">
                      <BarCell value={r.clearedFraction ?? 0} max={maxCleared} color={LONG} />
                    </td>
                    <td className="num" style={{ color: LONG }}>{usdCompact(r.liquidated24h)}</td>
                    <td className="num">{usdCompact(r.openInterest)}</td>
                    <td className="num text-[var(--text3)]">
                      {r.clearedFractionUnfiltered != null
                        ? pctPlain(100 * r.clearedFractionUnfiltered, 3)
                        : NA}
                    </td>
                    <td className="num text-[var(--text3)]">
                      {r.flaggedShare != null ? pctPlain(100 * r.flaggedShare) : NA}
                    </td>
                    <td className="num">
                      {r.fundingLongShare != null ? pctPlain(100 * r.fundingLongShare, 0) : NA}
                      <div className="text-[10px] text-[var(--text3)]">
                        {r.fundingPairs.long} / {r.fundingPairs.short} / {r.fundingPairs.flat}
                      </div>
                    </td>
                    <td className="num">
                      {r.premiumBps != null ? `${r.premiumBps >= 0 ? "+" : ""}${r.premiumBps.toFixed(1)} bp` : NA}
                      <div className="text-[10px] text-[var(--text3)]">
                        {r.premiumPairs.used} pairs
                        {r.premiumPairs.dropped > 0 && `, ${r.premiumPairs.dropped} dropped`}
                      </div>
                    </td>
                    <td className="num text-[var(--text3)]">
                      {r.cleanPairs} of {r.cleanPairs + r.flaggedPairs}
                      {r.pairsTotal != null && r.pairsTotal > r.cleanPairs + r.flaggedPairs && (
                        <span> of {r.pairsTotal}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>

            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--text3)]">
              <span>
                {data.coverage.priced} of {data.coverage.requested} coins priced,{" "}
                {data.coverage.reads} reads this refresh, {data.coverage.readFailures} failed,{" "}
                {data.credits} credits spent.
              </span>
              <InfoHint
                text="A coin CoinMarketCap cannot price keeps its row with a blank ratio and is counted here, because a table that silently drops its failures reads like a complete one."
                align="right"
              />
            </div>
          </>
        )}
      </Panel>
    </Section>
  );
}
