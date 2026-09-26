"use client";

import { useState } from "react";
import { AsOf, BarCell, ChangeChip, Loading, Panel, Section, Segmented, Sparkline, TableWrap, Th, Unavailable, useSort } from "@/components/ui";
import { pctPlain, usdCompact, ordinal, NA } from "@/lib/format";
import { useApi } from "@/lib/useApi";
import type { ForcedPayload, LiqRead } from "@/app/api/forced/route";
import type { LeveragePayload } from "@/app/api/leverage/route";
import { LiqStory } from "@/components/LiqStory";
import { SqueezeMap } from "@/components/SqueezeMap";

// Forced selling across every venue CoinMarketCap tracks, sitting directly
// under the Binance force-order tape so the comparison is structural rather
// than argued. The tape above is one venue. This is the same event, measured
// across nine.

type Window = "1h" | "4h" | "24h";
const WINDOWS: readonly Window[] = ["1h", "4h", "24h"];

/** A long liquidated is forced selling, so it reads red. A short reads green. */
const LONG = "var(--neg)";
const SHORT = "var(--pos)";

interface VenueRowView {
  id: number;
  name: string;
  streamed: boolean;
  total: number;
  long: number;
  short: number;
  share: number;
  /** Open interest on this venue across the nine majors, on pairs CoinMarketCap uses. */
  oi: number | null;
  /**
   * Share of the feed's liquidations over share of the feed's open interest.
   * Shares rather than a ratio of dollars, because the liquidations cover every
   * coin and the open interest only the nine majors. Near 1 is proportionate;
   * well above 1 is a venue liquidating more than its size.
   */
  vsSize: number | null;
}

interface CoinRowView {
  id: number;
  symbol: string;
  name: string;
  rank: number;
  total: number;
  long: number;
  short: number;
  priceChange: number | null;
  read: LiqRead | null;
}

/** The words and chip for each read. Colour follows the forced flow: a squeeze is forced buying. */
const READ: Record<LiqRead, { label: string; chip: string }> = {
  squeeze: { label: "Short squeeze", chip: "chip-pos" },
  flush: { label: "Long flush", chip: "chip-neg" },
  against: { label: "Against the move", chip: "chip-flat" },
  absorbed: { label: "Absorbed", chip: "chip-flat" },
  "two-sided": { label: "Two-sided", chip: "chip-flat" },
};

/** "SOL, XRP and 2 more", largest first. */
function names(rows: CoinRowView[]): string {
  const top = rows.slice(0, 3).map((r) => r.symbol);
  const rest = rows.length - top.length;
  if (rest > 0) return `${top.join(", ")} and ${rest} more`;
  if (top.length > 1) return `${top.slice(0, -1).join(", ")} and ${top[top.length - 1]}`;
  return top[0] ?? "";
}

/**
 * How the concentration reading reads in words.
 *
 * Thresholds, never a model. The number underneath is an effective venue count
 * and it is shown beside every one of these, so a reader can disagree with the
 * word and still have the figure.
 */
function concentrationWord(effectiveVenues: number, venues: number): string {
  if (effectiveVenues <= venues * 0.25) return "Concentrated";
  if (effectiveVenues <= venues * 0.5) return "Uneven";
  return "Broad";
}

/** A percentile as a reader says it: the ends of the record are named, not "0th". */
function rank(p: number | null): string {
  if (p == null) return NA;
  if (p <= 0) return "lowest";
  if (p >= 100) return "highest";
  return ordinal(p);
}

/** One 100% bar, segments labelled directly beneath so identity never rests on colour. */
function ShareBar({ label, parts }: { label: string; parts: { name: string; share: number; color: string }[] }) {
  return (
    <div>
      <div className="mb-1 text-[11px] text-[var(--text2)]">{label}</div>
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded" role="img" aria-label={`${label}: ${parts.map((p) => `${p.name} ${Math.round(100 * p.share)}%`).join(", ")}`}>
        {parts.map((p) => (
          <div key={p.name} style={{ width: `${100 * p.share}%`, background: p.color }} />
        ))}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] text-[var(--text2)]">
        {parts.map((p) => (
          <span key={p.name} className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: p.color }} />
            {p.name} {Math.round(100 * p.share)}%
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * What the feed sees, drawn rather than written. It replaced a five-line
 * paragraph: the tape covers Binance only, the feed covers nine venues, and
 * those nine hold under half of the open interest CoinMarketCap vouches for.
 * Amber is Binance, cyan the rest of the feed, grey what no feed here sees.
 */
function CoverageBars({
  w,
  streamedShare,
  venues,
  feedOiShare,
  binanceOiShare,
  oiVenueCount,
}: {
  w: string;
  streamedShare: number;
  venues: number;
  feedOiShare: number | null;
  binanceOiShare: number | null;
  oiVenueCount: number;
}) {
  const BINANCE = "var(--accent)";
  const FEED = "var(--cyan)";
  const UNSEEN = "var(--border)";
  return (
    <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-3">
      <ShareBar
        label={`Liquidations in the feed, ${w}`}
        parts={[
          { name: "Binance, on the tape", share: streamedShare, color: BINANCE },
          { name: `${venues - 1} other venues`, share: 1 - streamedShare, color: FEED },
        ]}
      />
      {feedOiShare != null && binanceOiShare != null && (
        <>
          <ShareBar
            label={`Open interest CoinMarketCap vouches for, ${oiVenueCount} venues`}
            parts={[
              { name: "Binance", share: binanceOiShare, color: BINANCE },
              { name: `${venues - 1} other feed venues`, share: Math.max(0, feedOiShare - binanceOiShare), color: FEED },
              { name: "outside the feed", share: 1 - feedOiShare, color: UNSEEN },
            ]}
          />
          <p className="text-[11px] leading-relaxed text-[var(--text3)]">
            If liquidations track open interest, the Binance tape sees about{" "}
            {Math.round(100 * streamedShare * feedOiShare)}% of the market. CoinMarketCap is owned by Binance.
          </p>
        </>
      )}
    </div>
  );
}

export function ForcedSelling() {
  const { data, loading, failed } = useApi<ForcedPayload>("/api/forced", 300);
  // Open interest by venue across roughly fifty venues, from the leverage desk.
  // It is how this panel measures its own feed: the liquidation data covers
  // nine venues, and CoinMarketCap is owned by Binance, so the reader should see
  // how much of the market those nine hold and how much of it is Binance.
  const lev = useApi<LeveragePayload>("/api/leverage", 900);
  const venueOi = lev.data?.ok ? lev.data.totals?.venueOpenInterest ?? [] : [];
  const oiTotal = venueOi.reduce((s, v) => s + v.openInterest, 0);
  const feedNames = new Set((data?.venues ?? []).map((v) => v.name));
  const feedOiShare = oiTotal > 0 ? venueOi.filter((v) => feedNames.has(v.venue)).reduce((s, v) => s + v.openInterest, 0) / oiTotal : null;
  const binanceOiShare = oiTotal > 0 ? (venueOi.find((v) => v.venue === "Binance")?.openInterest ?? 0) / oiTotal : null;
  const oiVenueCount = venueOi.length;
  const [w, setW] = useState<Window>("24h");

  const win = data?.windows?.[w] ?? null;

  const venueOiByName = new Map(venueOi.map((v) => [v.venue, v.openInterest]));
  const feedOi = (data?.venues ?? []).reduce((s, v) => s + (venueOiByName.get(v.name) ?? 0), 0);
  const venueRows: VenueRowView[] = (data?.venues ?? []).map((v) => {
    const oi = venueOiByName.get(v.name) ?? null;
    const oiShare = oi != null && feedOi > 0 ? oi / feedOi : null;
    return {
      id: v.id,
      name: v.name,
      streamed: v.streamed,
      ...v.by[w],
      oi,
      vsSize: oiShare && oiShare > 0.002 ? v.by[w].share / oiShare : null,
    };
  });

  const coinRows: CoinRowView[] = (data?.coins ?? []).map((c) => ({
    id: c.id,
    symbol: c.symbol,
    name: c.name,
    rank: c.rank,
    ...c.by[w],
  }));

  const venueSort = useSort(venueRows, { key: "total" });
  const coinSort = useSort(coinRows, { key: "total" });

  const maxVenue = Math.max(0, ...venueRows.map((r) => r.total));
  const maxCoin = Math.max(0, ...coinRows.map((r) => r.total));
  const byTotal = [...coinRows].sort((a, b) => b.total - a.total);
  const squeezes = byTotal.filter((r) => r.read === "squeeze");
  const flushes = byTotal.filter((r) => r.read === "flush");
  const readable = coinRows.filter((r) => r.read != null).length;

  return (
    <Section
      title="Forced selling, all venues"
      id="forced"
      hint="Liquidation value aggregated across the nine derivatives venues CoinMarketCap reports, which is the whole universe this feed covers. The tape above is Binance alone. Long liquidated means forced selling."
      right={<Segmented options={WINDOWS} value={w} onChange={setW} ariaLabel="Liquidation window" />}
    >
      <Panel
        title={`Cross-venue liquidations, ${w}`}
        right={<AsOf iso={data?.asOf} staleMs={45 * 60 * 1000} />}
      >
        {loading && <Loading rows={6} />}

        {!loading && (failed || !data?.ok || !win) && (
          <Unavailable what="Cross-venue liquidations" reason={data?.failure} />
        )}

        {!loading && data?.ok && win && (
          <>
            <LiqStory
              w={w}
              win={win}
              venues={data.coverage.venues}
              coins={data.coins}
              pool={
                lev.data?.ok && lev.data.totals
                  ? {
                      openInterest: lev.data.totals.openInterest,
                      liquidated24h: lev.data.totals.liquidated24h,
                      coins: lev.data.coverage.priced,
                    }
                  : null
              }
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="font-mono text-2xl font-bold tabular-nums text-[var(--text)]">
                  {usdCompact(win.total)}
                </div>
                <div className="mt-1 text-[11px] text-[var(--text3)]">
                  liquidated across {data.coverage.venues} venues in the last {w}
                </div>

                <div className="mt-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2 font-mono text-[11px] tabular-nums">
                    <span style={{ color: LONG }}>longs {usdCompact(win.long)}</span>
                    <span style={{ color: SHORT }}>shorts {usdCompact(win.short)}</span>
                  </div>
                  <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface2)]">
                    <div
                      className="h-full"
                      style={{
                        width: `${win.total > 0 ? (100 * win.long) / win.total : 0}%`,
                        background: LONG,
                      }}
                    />
                    <div
                      className="h-full"
                      style={{
                        width: `${win.total > 0 ? (100 * win.short) / win.total : 0}%`,
                        background: SHORT,
                      }}
                    />
                  </div>
                </div>
              </div>

              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text3)]">
                  How far it spread
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="font-mono text-[26px] font-semibold tabular-nums text-[var(--text)]">
                    {win.effectiveVenues.toFixed(1)}
                  </span>
                  <span className="text-[12px] text-[var(--text2)]">
                    effective venues of {data.coverage.venues}. {concentrationWord(win.effectiveVenues, data.coverage.venues)},
                    and {win.largestVenue} carried {pctPlain(100 * win.largestShare, 0)}.
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-md border border-[var(--border)] px-2.5 py-1.5">
                    <div className="font-mono text-[15px] font-semibold tabular-nums text-[var(--text)]">
                      {rank(win.scorePercentile)}
                    </div>
                    <div className="text-[10px] leading-snug text-[var(--text3)]">concentration against its history</div>
                  </div>
                  <div className="rounded-md border border-[var(--border)] px-2.5 py-1.5">
                    <div className="font-mono text-[15px] font-semibold tabular-nums text-[var(--text)]">
                      {rank(win.totalPercentile)}
                    </div>
                    <div className="text-[10px] leading-snug text-[var(--text3)]">{w} size against its history</div>
                  </div>
                </div>
                <div className="mt-1.5 text-[10px] text-[var(--text3)]">
                  {win.scorePercentile != null
                    ? `Ranked against ${data.sample.n} samples collected since ${data.sample.from?.slice(0, 10) ?? "polling began"}.`
                    : `${data.sample.n} samples collected so far, too few to rank against.`}
                </div>
                {(data.history?.[w]?.score.length ?? 0) >= 2 && (
                  <div className="mt-3">
                    <div className="mb-1 text-[10px] uppercase tracking-[0.08em] text-[var(--text3)]">
                      Concentration, last {data.history[w].score.length} readings
                    </div>
                    <Sparkline
                      data={[...data.history[w].score, win.score]}
                      width={220}
                      height={36}
                      stroke="var(--text3)"
                    />
                    <div className="mt-1 text-[10px] text-[var(--text3)]">
                      Collected by this terminal. CoinMarketCap publishes no liquidation history.
                    </div>
                  </div>
                )}
              </div>
            </div>

            {win.streamedShare != null && (
              <CoverageBars
                w={w}
                streamedShare={win.streamedShare}
                venues={data.coverage.venues}
                feedOiShare={feedOiShare}
                binanceOiShare={binanceOiShare}
                oiVenueCount={oiVenueCount}
              />
            )}

            <div className="mt-5">
              <h4 className="panel-h mb-2 font-display text-[11px] font-bold uppercase tracking-[0.09em]">
                By venue
              </h4>
              <TableWrap maxHeight={340}>
                <thead>
                  <tr>
                    <Th label="Venue" sortKey="name" sort={venueSort} />
                    <Th label={`Liquidated, ${w}`} sortKey="total" sort={venueSort} num />
                    <Th label="Share" sortKey="share" sort={venueSort} num />
                    <Th
                      label="Open interest"
                      sortKey="oi"
                      sort={venueSort}
                      num
                      hint="Money in open leveraged bets on this exchange, across the nine biggest coins, counting only pairs CoinMarketCap uses in its own figures."
                    />
                    <Th
                      label="Vs its size"
                      sortKey="vsSize"
                      sort={venueSort}
                      num
                      hint="This exchange's share of the liquidations divided by its share of the open interest. 1.0x is in proportion to its size. Above 1 it liquidated more than its size, a hot spot; below 1, less. Shares are compared because the liquidations cover every coin and the open interest the nine biggest."
                    />
                    <Th
                      label="Longs"
                      sortKey="long"
                      sort={venueSort}
                      num
                      hint="A long liquidated is a forced sale into the bid. Shorts are the other side."
                    />
                    <Th label="Shorts" sortKey="short" sort={venueSort} num />
                    <Th label="" className="w-24" />
                  </tr>
                </thead>
                <tbody>
                  {venueSort.sorted.map((r) => (
                    <tr key={r.id}>
                      <td className="ident break-words">
                        {r.name}
                        {r.streamed && (
                          <span
                            className="ml-1.5 whitespace-nowrap text-[10px] text-[var(--text3)]"
                            title="The terminal's live liquidation feed, in the Liquidations section, streams this exchange only."
                          >
                            (streamed live)
                          </span>
                        )}
                      </td>
                      <td className="num">{usdCompact(r.total)}</td>
                      <td className="num">{pctPlain(100 * r.share)}</td>
                      <td className="num text-[var(--text2)]">{r.oi != null ? usdCompact(r.oi) : NA}</td>
                      <td
                        className="num font-semibold"
                        style={{ color: r.vsSize == null ? "var(--text3)" : r.vsSize >= 1.5 ? "var(--neg)" : "var(--text)" }}
                      >
                        {r.vsSize != null ? `${r.vsSize.toFixed(1)}x` : NA}
                      </td>
                      <td className="num" style={{ color: LONG }}>{usdCompact(r.long)}</td>
                      <td className="num" style={{ color: SHORT }}>{usdCompact(r.short)}</td>
                      <td className="num">
                        <BarCell value={r.total} max={maxVenue} color={r.streamed ? "var(--gold)" : "var(--text3)"} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>

            <div className="mt-5">
              <h4 className="panel-h mb-2 font-display text-[11px] font-bold uppercase tracking-[0.09em]">
                By coin
              </h4>
              {readable > 0 && (
                <p className="mb-2 text-[11px] leading-relaxed text-[var(--text2)]">
                  {squeezes.length === 0 && flushes.length === 0 ? (
                    <>
                      Over {w}, no coin shows one side forced out in the direction of its move. The
                      liquidations are two-sided or ran against the move.
                    </>
                  ) : (
                    <>
                      Over {w},{" "}
                      {squeezes.length > 0 && (
                        <>
                          shorts were squeezed on {names(squeezes)}
                          {flushes.length > 0 ? " and " : "."}
                        </>
                      )}
                      {flushes.length > 0 && <>longs were flushed on {names(flushes)}.</>}
                    </>
                  )}{" "}
                  A squeeze means shorts carried at least two thirds of the coin&apos;s liquidations
                  while its Binance price rose over the same rolling window; a flush is the mirror.
                </p>
              )}
              <SqueezeMap coins={data.coins} w={w} />
              <TableWrap maxHeight={420}>
                <thead>
                  <tr>
                    <Th label="Coin" sortKey="symbol" sort={coinSort} />
                    <Th
                      label="Market cap rank"
                      sortKey="rank"
                      sort={coinSort}
                      num
                      hint="CoinMarketCap's market cap rank. A low-ranked name near the top of this table is the interesting row."
                    />
                    <Th label={`Liquidated, ${w}`} sortKey="total" sort={coinSort} num />
                    <Th label="Longs" sortKey="long" sort={coinSort} num />
                    <Th label="Shorts" sortKey="short" sort={coinSort} num />
                    <Th label="" className="w-24" />
                    <Th
                      label={`Price, ${w}`}
                      sortKey="priceChange"
                      sort={coinSort}
                      num
                      hint="Binance spot, USDT pair, over the same rolling window as the liquidations. Blank when Binance does not list the coin."
                    />
                    <Th
                      label="Read"
                      sortKey="read"
                      sort={coinSort}
                      hint="The losing side set against the move. Short squeeze: shorts carried two thirds or more while the price rose. Long flush: the mirror. Against the move: the side the move favoured was the one liquidated, so a wick went the other way first. Absorbed: one side was forced out and the price moved less than 0.2% an hour, 0.4% over four hours or 1% a day, so the orders were taken without moving it. Two-sided: neither side carried two thirds. Blank under $250K in the window, where a few positions decide the split."
                    />
                  </tr>
                </thead>
                <tbody>
                  {coinSort.sorted.map((r) => (
                    <tr key={r.id}>
                      <td className="ident break-words">
                        <span className="font-semibold">{r.symbol}</span>{" "}
                        <span className="text-[var(--text3)]">{r.name}</span>
                      </td>
                      <td className="num">{r.rank || NA}</td>
                      <td className="num">{usdCompact(r.total)}</td>
                      <td className="num" style={{ color: LONG }}>{usdCompact(r.long)}</td>
                      <td className="num" style={{ color: SHORT }}>{usdCompact(r.short)}</td>
                      <td className="num">
                        <BarCell value={r.total} max={maxCoin} color="var(--text3)" />
                      </td>
                      <td className="num">
                        <ChangeChip value={r.priceChange} />
                      </td>
                      <td>
                        {r.read ? (
                          <span
                            className={`${READ[r.read].chip} whitespace-nowrap rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold`}
                          >
                            {READ[r.read].label}
                          </span>
                        ) : (
                          <span className="text-[var(--text3)]">{NA}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
              <p className="mt-2 text-[11px] text-[var(--text3)]">
                Showing {coinRows.length} of {data.coverage.coinsTotal ?? coinRows.length} coins with
                liquidations. The feed pages at 100 rows and this panel keeps the largest 30 by 24h
                value.
              </p>
            </div>
          </>
        )}
      </Panel>
    </Section>
  );
}
