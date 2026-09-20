"use client";

import { AsOf, BarCell, InfoHint, Loading, Panel, Section, TableWrap, Th, Unavailable, useSort } from "@/components/ui";
import { pctPlain, usdCompact , NA} from "@/lib/format";
import { useApi } from "@/lib/useApi";
import type { LeveragePayload, LeverageRow } from "@/app/api/leverage/route";

// How much of the standing leverage a day's liquidations actually cleared, and
// how much of the open interest underneath that ratio CoinMarketCap says it
// does not stand behind.
//
// Two readings on one table. The first ranks by damage rather than by dollars:
// a coin with $7m liquidated against $1.3bn of open interest lost more of its
// book than one with $64m against $40bn, and a table sorted on dollar value
// puts them in the opposite order. The second is the denominator itself.

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
      title="Leverage cleared"
      id="leverage"
      hint="A day's liquidations as a share of the open interest standing behind them. Open interest is summed from the market pairs CoinMarketCap vouches for, excluding the pairs it flags as outliers or excludes from its own aggregates."
    >
      <Panel
        title="Liquidated against open interest, 24h"
        right={<AsOf iso={data?.asOf} staleMs={3 * 3600 * 1000} />}
      >
        {loading && <Loading rows={6} />}

        {!loading && (failed || !data?.ok) && (
          <Unavailable what="Leverage cleared" reason={data?.failure} />
        )}

        {!loading && data?.ok && totals && (
          <>
            {flaggedShare != null && (
              <p className="mb-4 text-[11px] leading-relaxed text-[var(--text2)]">
                Across these {data.coverage.priced} coins, venues report{" "}
                <span className="font-mono tabular-nums">{usdCompact(reported)}</span> of open
                interest. CoinMarketCap flags{" "}
                <span className="font-mono tabular-nums">{pctPlain(100 * flaggedShare)}</span> of it,{" "}
                <span className="font-mono tabular-nums">{usdCompact(totals.flaggedOpenInterest)}</span>,
                as outlying or excluded from its own aggregates. Every ratio in this table divides by
                the{" "}
                <span className="font-mono tabular-nums">{usdCompact(totals.openInterest)}</span>{" "}
                that is left, and the unfiltered figure is shown beside it so the gap is visible.
              </p>
            )}

            <TableWrap maxHeight={420}>
              <thead>
                <tr>
                  <Th label="Coin" sortKey="symbol" sort={sort} />
                  <Th
                    label="Liquidated, 24h"
                    sortKey="liquidated24h"
                    sort={sort}
                    num
                    hint="Across the nine derivatives venues CoinMarketCap reports, which is the whole universe of that feed."
                  />
                  <Th
                    label="Open interest"
                    sortKey="openInterest"
                    sort={sort}
                    num
                    hint="Summed across the market pairs CoinMarketCap vouches for. Pairs it marks outlying, or excludes from price or volume, are counted in the flagged column instead."
                  />
                  <Th
                    label="Cleared"
                    sortKey="clearedFraction"
                    sort={sort}
                    num
                    hint="Liquidated value over vouched-for open interest. This ranks by how much of a book went, so a small coin losing half a percent sits above a major losing a tenth."
                  />
                  <Th label="" className="w-24" />
                  <Th
                    label="Unfiltered"
                    sortKey="clearedFractionUnfiltered"
                    sort={sort}
                    num
                    hint="The same ratio divided by every pair the venues report, flagged ones included. This is what a reading that trusts the raw feed would show."
                  />
                  <Th
                    label="Flagged OI"
                    sortKey="flaggedShare"
                    sort={sort}
                    num
                    hint="Share of reported open interest sitting on pairs CoinMarketCap does not stand behind."
                  />
                  <Th label="Pairs" sortKey="cleanPairs" sort={sort} num />
                </tr>
              </thead>
              <tbody>
                {sort.sorted.map((r) => (
                  <tr key={r.symbol}>
                    <td className="ident break-words font-semibold">{r.symbol}</td>
                    <td className="num" style={{ color: LONG }}>{usdCompact(r.liquidated24h)}</td>
                    <td className="num">{usdCompact(r.openInterest)}</td>
                    <td className="num">
                      {r.clearedFraction != null ? pctPlain(100 * r.clearedFraction, 3) : NA}
                    </td>
                    <td className="num">
                      <BarCell value={r.clearedFraction ?? 0} max={maxCleared} color={LONG} />
                    </td>
                    <td className="num text-[var(--text3)]">
                      {r.clearedFractionUnfiltered != null
                        ? pctPlain(100 * r.clearedFractionUnfiltered, 3)
                        : NA}
                    </td>
                    <td className="num text-[var(--text3)]">
                      {r.flaggedShare != null ? pctPlain(100 * r.flaggedShare) : NA}
                    </td>
                    <td className="num text-[var(--text3)]">
                      {r.cleanPairs} of {r.cleanPairs + r.flaggedPairs}
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
