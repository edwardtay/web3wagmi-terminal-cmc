"use client";

import { usdCompact, pctPlain } from "@/lib/format";
import type { ForcedPayload } from "@/app/api/forced/route";

// The liquidation panel in plain words, for a reader who has never traded.
//
// Three steps in the order the thing happens: traders borrow to bet (the pool),
// the exchange force-closes the losing bets (the liquidations, which are the
// forced buying and selling), and that pushes prices (the squeezes and
// flushes). Every sentence is computed from the same payload the panel draws,
// so the words cannot say something the numbers do not.

type Win = NonNullable<ForcedPayload["windows"]>["24h"];
type Coin = ForcedPayload["coins"][number];

function verdict(p: number | null): string | null {
  if (p == null) return null;
  if (p <= 10) return "one of the quietest on record";
  if (p < 35) return "quieter than usual";
  if (p < 65) return "about normal";
  if (p < 90) return "busier than usual";
  return "one of the heaviest on record";
}

function names(list: string[]): string {
  if (list.length <= 1) return list[0] ?? "";
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, 2).join(", ")} and ${list.length - 2} more`;
}

function Step({ n, title, figure, children }: { n: number; title: string; figure: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg2)] p-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text3)]">
        {n}. {title}
      </div>
      <div className="mt-1 font-mono text-[20px] font-semibold tabular-nums text-[var(--text)]">{figure}</div>
      <div className="mt-1 text-[12px] leading-relaxed text-[var(--text2)]">{children}</div>
    </div>
  );
}

export function LiqStory({
  w,
  win,
  venues,
  coins,
  pool,
}: {
  w: string;
  win: Win;
  venues: number;
  coins: Coin[];
  /** Filtered open interest and the liquidations on the same coins, from the leverage desk. */
  pool: { openInterest: number; liquidated24h: number; coins: number } | null;
}) {
  const longShare = win.total > 0 ? win.long / win.total : 0.5;
  const mood = verdict(win.totalPercentile);
  // Named coins come from the 300 largest by market cap, the ones a reader is
  // likely to know. The table below lists the rest.
  const known = coins.filter((c) => c.rank > 0 && c.rank <= 300);
  const squeezed = known.filter((c) => c.by[w as keyof Coin["by"]]?.read === "squeeze").map((c) => c.symbol);
  const flushed = known.filter((c) => c.by[w as keyof Coin["by"]]?.read === "flush").map((c) => c.symbol);
  const concentrated = win.effectiveVenues <= venues * 0.25;

  const side =
    longShare >= 0.6
      ? "Mostly traders betting on a rise were forced out, so the forced orders were sells."
      : longShare <= 0.4
        ? "Mostly traders betting on a fall were forced out, so the forced orders were buys."
        : "Traders betting both ways were hit about equally, so neither side dominated.";

  return (
    <div className="mb-5">
      <p className="mb-3 text-[13px] leading-relaxed text-[var(--text)]">
        <span className="font-semibold">In plain words:</span> {usdCompact(win.total)} of borrowed bets were
        force-closed across {venues} exchanges in the last {w}
        {mood ? <>, {mood}</> : null}.{" "}
        {concentrated
          ? `Most of it was on one exchange, ${win.largestVenue}.`
          : `It was spread across about ${Math.round(win.effectiveVenues)} exchanges' worth, within this feed. That measures spread, not the cause of the move.`}
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Step
          n={1}
          title="The bets"
          figure={pool ? usdCompact(pool.openInterest) : "n/a"}
          >
          {pool
            ? `was reported in open positions across ${pool.coins} sampled coins, after excluding pairs flagged for price or volume.`
            : "The size of the betting pool did not load."}
        </Step>
        <Step n={2} title="Force-closed" figure={usdCompact(win.total)}>
          {side}{" "}
          <span className="whitespace-nowrap">
            <span className="font-mono tabular-nums" style={{ color: "var(--neg)" }}>
              {usdCompact(win.long)}
            </span>{" "}
            sold,{" "}
            <span className="font-mono tabular-nums" style={{ color: "var(--pos)" }}>
              {usdCompact(win.short)}
            </span>{" "}
            bought.
          </span>
          {pool && w === "24h" && pool.openInterest > 0 && (
            <> On those {pool.coins} coins, liquidations / filtered open interest was {pctPlain((100 * pool.liquidated24h) / pool.openInterest, 2)}. The venue sets differ, so this is a comparison ratio.</>
          )}
        </Step>
        <Step
          n={3}
          title="Alongside price moves"
          figure={squeezed.length || flushed.length ? `${squeezed.length + flushed.length} coins` : "No pattern"}
        >
          {squeezed.length > 0 && <>Shorts were squeezed on {names(squeezed)}: forced buying as the price rose. </>}
          {flushed.length > 0 && <>Longs were flushed on {names(flushed)}: forced selling as the price fell. </>}
          {!squeezed.length && !flushed.length && "No top 300 coin shows one side forced out in the direction its price moved."}
        </Step>
      </div>
    </div>
  );
}
