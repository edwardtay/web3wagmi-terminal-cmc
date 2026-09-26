"use client";

import { useState } from "react";
import { AsOf, BarCell, ChangeChip, Loading, Meter, Panel, Section, Segmented, Sparkline, TableWrap, Th, Unavailable, useSort } from "@/components/ui";
import { pctPlain, usdCompact, ordinal, NA } from "@/lib/format";
import { useApi } from "@/lib/useApi";
import type { ForcedPayload, LiqRead } from "@/app/api/forced/route";
import type { LeveragePayload } from "@/app/api/leverage/route";

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

  const venueRows: VenueRowView[] = (data?.venues ?? []).map((v) => ({
    id: v.id,
    name: v.name,
    streamed: v.streamed,
    ...v.by[w],
  }));

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
                <Meter
                  label="Venue concentration"
                  score={win.score}
                  color={win.score >= 50 ? "var(--neg)" : win.score >= 25 ? "var(--gold)" : "var(--pos)"}
                  caption={`${win.largestVenue} carried ${pctPlain(100 * win.largestShare)} of it`}
                />
                <div className="mt-2 font-mono text-[11px] tabular-nums text-[var(--text2)]">
                  {win.effectiveVenues.toFixed(1)} effective venues of {data.coverage.venues} reporting
                </div>
                <div className="mt-1 text-[11px] leading-relaxed text-[var(--text3)]">
                  {concentrationWord(win.effectiveVenues, data.coverage.venues)}.{" "}
                  {win.scorePercentile != null ? (
                    <>
                      That is the {ordinal(win.scorePercentile)} percentile of concentration in the{" "}
                      {data.sample.n} samples collected since{" "}
                      {data.sample.from ? data.sample.from.slice(0, 10) : "polling began"}.
                    </>
                  ) : (
                    <>
                      The collected series holds {data.sample.n}{" "}
                      {data.sample.n === 1 ? "sample" : "samples"}, too few to rank this against. The
                      feed publishes no history, so the series only grows forward.
                    </>
                  )}
                  {win.totalPercentile != null && (
                    <>
                      {" "}By size, the {usdCompact(win.total)} total is the{" "}
                      {ordinal(win.totalPercentile)} percentile of {w} windows.
                    </>
                  )}
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
              <p className="mt-4 border-t border-[var(--border)] pt-3 text-[11px] leading-relaxed text-[var(--text2)]">
                The terminal&apos;s force-order tape covers Binance only, which carried{" "}
                <span className="font-mono tabular-nums">{pctPlain(100 * win.streamedShare)}</span> of
                this {w} window. The other{" "}
                <span className="font-mono tabular-nums">{pctPlain(100 * (1 - win.streamedShare))}</span>,{" "}
                {usdCompact(win.total * (1 - win.streamedShare))}, never reached it.
                {feedOiShare != null && binanceOiShare != null && (
                  <>
                    {" "}The feed itself is partial. Its {data.coverage.venues} venues hold{" "}
                    <span className="font-mono tabular-nums">{pctPlain(100 * feedOiShare, 0)}</span> of the
                    open interest CoinMarketCap vouches for across {oiVenueCount} venues on {lev.data?.coverage.priced ?? 9}{" "}
                    majors, and Binance alone holds{" "}
                    <span className="font-mono tabular-nums">{pctPlain(100 * binanceOiShare, 0)}</span>. So
                    Binance&apos;s share above is a share of the visible part of the market. If liquidations
                    elsewhere track open interest, the tape saw about{" "}
                    <span className="font-mono tabular-nums">
                      {pctPlain(100 * win.streamedShare * feedOiShare, 0)}
                    </span>{" "}
                    of the whole. CoinMarketCap is owned by Binance, which is one more reason to show this.
                  </>
                )}
              </p>
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
                          <span className="ml-1.5 whitespace-nowrap text-[10px] text-[var(--text3)]">
                            (on the tape)
                          </span>
                        )}
                      </td>
                      <td className="num">{usdCompact(r.total)}</td>
                      <td className="num">{pctPlain(100 * r.share)}</td>
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
              <TableWrap maxHeight={420}>
                <thead>
                  <tr>
                    <Th label="Coin" sortKey="symbol" sort={coinSort} />
                    <Th
                      label="Rank"
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
