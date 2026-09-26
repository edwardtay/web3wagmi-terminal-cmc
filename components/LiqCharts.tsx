"use client";

import { useState } from "react";
import { Panel } from "@/components/ui";
import { clockTime, pctPlain, usdCompact } from "@/lib/format";
import { useApi } from "@/lib/useApi";
import type { LiqTapePayload } from "@/app/api/liqtape/route";

// Two charts over the Binance force orders the server records.
//
// The minute chart is diverging on purpose: shorts liquidated above the
// baseline, longs below. Position carries the side as well as colour, because
// the long and short tokens are the red and green pair, which separates for a
// deuteranope by only ~9 ΔE in light mode and ~5 in dark (validated with the
// dataviz palette script, 2026-09-26). A colour-blind reader still reads up as
// forced buying and down as forced selling.
//
// The size chart answers the question a tape cannot: whether the dollars come
// from many small prints or a few large ones. Count and dollar share sit on one
// 0 to 100% axis, so there is no second scale.

const LONG = "var(--neg)";
const SHORT = "var(--pos)";
const COUNT = "var(--cyan)";
const DOLLARS = "var(--accent)";

function bucketLabel(from: number, to: number | null): string {
  if (to == null) return `${usdCompact(from, 0)}+`;
  if (from === 0) return `under ${usdCompact(to, 0)}`;
  return `${usdCompact(from, 0)} to ${usdCompact(to, 0)}`;
}

function MinuteChart({ minutes }: { minutes: LiqTapePayload["minutes"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 610;
  const H = 150;
  const mid = H / 2;
  const pad = 6;
  const max = Math.max(1, ...minutes.map((m) => Math.max(m.long, m.short)));
  const slot = W / minutes.length;
  const barW = Math.max(2, slot - 2);
  const h = (v: number) => (v / max) * (mid - pad);
  const hovered = hover != null ? minutes[hover] : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-[150px] w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label="Binance liquidations per minute over the last hour, shorts above the line and longs below"
        onMouseLeave={() => setHover(null)}
      >
        <line x1={0} x2={W} y1={mid} y2={mid} stroke="var(--border)" strokeWidth={1} />
        {minutes.map((m, i) => {
          const x = i * slot + (slot - barW) / 2;
          const up = h(m.short);
          const down = h(m.long);
          const dim = hover != null && hover !== i;
          return (
            <g key={m.t} opacity={dim ? 0.45 : 1}>
              {up > 0 && <rect x={x} y={mid - up - 1} width={barW} height={up} rx={1.5} fill={SHORT} />}
              {down > 0 && <rect x={x} y={mid + 1} width={barW} height={down} rx={1.5} fill={LONG} />}
              {/* The hit target is the whole column, wider than the mark. */}
              <rect x={i * slot} y={0} width={slot} height={H} fill="transparent" onMouseEnter={() => setHover(i)} />
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-[var(--text3)]">
        <span>{clockTime(minutes[0]?.t ?? Date.now()).slice(0, 5)}</span>
        <span>{usdCompact(max, 0)} a minute at the tallest bar</span>
        <span>now</span>
      </div>
      {hovered && (
        <div
          className="pointer-events-none absolute top-1 z-10 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 font-mono text-[10px] leading-relaxed text-[var(--text2)] shadow-sm"
          style={{ left: `min(calc(${((hover ?? 0) + 0.5) * (100 / minutes.length)}% + 8px), calc(100% - 170px))` }}
        >
          <div className="text-[var(--text)]">{clockTime(hovered.t).slice(0, 5)}</div>
          <div>shorts {usdCompact(hovered.short)}</div>
          <div>longs {usdCompact(hovered.long)}</div>
          <div>{hovered.count} prints</div>
        </div>
      )}
    </div>
  );
}

function SizeChart({ sizes }: { sizes: LiqTapePayload["sizes"] }) {
  const count = sizes.reduce((s, b) => s + b.count, 0);
  const usd = sizes.reduce((s, b) => s + b.usd, 0);
  if (!count) return null;
  const big = sizes.filter((b) => b.from >= 100_000);
  const bigCount = big.reduce((s, b) => s + b.count, 0) / count;
  const bigUsd = big.reduce((s, b) => s + b.usd, 0) / usd;

  return (
    <div>
      <p className="mb-3 text-[11px] leading-relaxed text-[var(--text2)]">
        {bigCount > 0 ? (
          <>
            Prints of $100K and up were{" "}
            <span className="font-mono tabular-nums">{pctPlain(100 * bigCount)}</span> of the count and{" "}
            <span className="font-mono tabular-nums">{pctPlain(100 * bigUsd)}</span> of the dollars.
          </>
        ) : (
          <>No print has reached $100K since recording began, so the dollars come from small positions.</>
        )}
      </p>
      <div className="mb-2 flex flex-wrap gap-3 font-mono text-[10px] text-[var(--text2)]">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-3 rounded-sm" style={{ background: COUNT }} />
          share of prints
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-3 rounded-sm" style={{ background: DOLLARS }} />
          share of dollars
        </span>
      </div>
      <div className="space-y-2">
        {/* An empty top bucket is two zero bars that say nothing. */}
        {sizes.filter((b) => b.count > 0 || b.to != null).map((b) => {
          const c = b.count / count;
          const d = b.usd / usd;
          return (
            <div key={b.from} className="grid grid-cols-[88px_1fr] items-center gap-2">
              <span className="font-mono text-[10px] text-[var(--text2)]">{bucketLabel(b.from, b.to)}</span>
              <div className="space-y-[2px]">
                {[
                  { v: c, color: COUNT, label: `${pctPlain(100 * c)} of prints, ${b.count}` },
                  { v: d, color: DOLLARS, label: `${pctPlain(100 * d)} of dollars, ${usdCompact(b.usd)}` },
                ].map((bar) => (
                  <div key={bar.label} className="flex items-center gap-2" title={bar.label}>
                    <div className="h-[7px] flex-1 overflow-hidden rounded-sm bg-[var(--bg2)]">
                      <div className="h-full rounded-sm" style={{ width: `${Math.max(bar.v > 0 ? 1 : 0, 100 * bar.v)}%`, background: bar.color }} />
                    </div>
                    <span className="w-10 text-right font-mono text-[10px] tabular-nums text-[var(--text2)]">
                      {pctPlain(100 * bar.v, 0)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function LiqCharts({ stacked = false }: { stacked?: boolean }) {
  const { data } = useApi<LiqTapePayload>("/api/liqtape", 30);
  if (!data) return null;
  const hourLong = data.minutes.reduce((s, m) => s + m.long, 0);
  const hourShort = data.minutes.reduce((s, m) => s + m.short, 0);
  const empty = data.window.count === 0;
  const since = data.window.from ?? data.startedAt;

  return (
    <div className={stacked ? "grid grid-cols-1 gap-4" : "grid grid-cols-1 gap-3 lg:grid-cols-[1.45fr_1fr]"}>
      <Panel
        title="Last hour, per minute"
        hint="Binance force orders recorded by this server. Shorts liquidated plot above the line (forced buying), longs below (forced selling). The stream sends at most one print per symbol per second, so this is a snapshot of the tape rather than every fill."
        right={
          <span className="whitespace-nowrap font-mono text-[11px] text-[var(--text3)]">
            longs {usdCompact(hourLong)} · shorts {usdCompact(hourShort)}
          </span>
        }
      >
        {empty ? (
          <p className="py-6 text-center font-mono text-[11px] text-[var(--text3)]">
            Recording{since ? ` since ${clockTime(Date.parse(since)).slice(0, 5)}` : ""}. The chart fills as prints arrive.
          </p>
        ) : (
          <>
            <div className="mb-1 flex flex-wrap gap-3 font-mono text-[10px] text-[var(--text2)]">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2 w-3 rounded-sm" style={{ background: SHORT }} />
                above: shorts liquidated
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2 w-3 rounded-sm" style={{ background: LONG }} />
                below: longs liquidated
              </span>
            </div>
            <MinuteChart minutes={data.minutes} />
          </>
        )}
      </Panel>
      <Panel
        title="Where the dollars come from"
        hint="Every print recorded in the window, bucketed by size. The buckets are logarithmic because liquidation sizes span five orders of magnitude."
        right={
          since ? (
            <span className="whitespace-nowrap font-mono text-[11px] text-[var(--text3)]">
              since {clockTime(Date.parse(since)).slice(0, 5)}
            </span>
          ) : undefined
        }
      >
        {empty ? (
          <p className="py-6 text-center font-mono text-[11px] text-[var(--text3)]">Fills with the first prints.</p>
        ) : (
          <SizeChart sizes={data.sizes} />
        )}
      </Panel>
    </div>
  );
}
