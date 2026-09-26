"use client";

import { useEffect, useRef, useState } from "react";
import { usdCompact } from "@/lib/format";
import type { ForcedPayload } from "@/app/api/forced/route";

// Who got squeezed, as a map rather than a table to read row by row.
//
// Each coin is a bubble. Left to right is what its price did over the window;
// bottom to top is which side was forced out, from all longs to all shorts.
// So the four corners are the four stories, labelled in words: top right is
// shorts squeezed (forced buying into a rise), bottom left is longs flushed
// (forced selling into a fall), and the other two are the side the move
// favoured getting caught by a wick. Bubble area is the dollars liquidated.
//
// Drawn at the container's real pixel width so labels stay legible on a phone;
// a viewBox scaled to 360px would shrink them to half size.

type Coin = ForcedPayload["coins"][number];
type Key = keyof Coin["by"];

const SQUEEZE = "var(--pos)";
const FLUSH = "var(--neg)";
const OTHER = "var(--text3)";
const MAX_COINS = 25;
const LABELLED = 8;

export function SqueezeMap({ coins, w }: { coins: Coin[]; w: Key }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rows = coins
    .map((c) => ({ c, v: c.by[w] }))
    .filter(({ v }) => v && v.total > 0 && v.priceChange != null)
    .sort((a, b) => b.v.total - a.v.total)
    .slice(0, MAX_COINS);

  const H = width < 480 ? 280 : 320;
  const PAD = { l: 12, r: 12, t: 24, b: 28 };
  const iw = Math.max(0, width - PAD.l - PAD.r);
  const ih = H - PAD.t - PAD.b;

  // Symmetric price axis, set by the larger of the 90th percentile move and a
  // floor, so one runaway coin does not squash the rest. Outliers pin to the edge.
  const moves = rows.map((r) => Math.abs(r.v.priceChange ?? 0)).sort((a, b) => a - b);
  const p90 = moves[Math.floor(moves.length * 0.9)] ?? 1;
  const span = Math.max(2, p90 * 1.15);
  const maxUsd = Math.max(1, ...rows.map((r) => r.v.total));
  const x = (p: number) => PAD.l + ((Math.max(-span, Math.min(span, p)) + span) / (2 * span)) * iw;
  const y = (shortShare: number) => PAD.t + (1 - shortShare) * ih;
  const r = (usd: number) => 4 + 20 * Math.sqrt(usd / maxUsd);

  const hovered = rows.find((row) => row.c.symbol === hover);

  // Label placement, largest coins first: above the bubble, else below, else
  // no label. Overlapping names are worse than a missing one, and hovering
  // still shows every coin.
  const labels = new Map<string, { x: number; y: number }>();
  const boxes: { l: number; r: number; t: number; b: number }[] = [];
  const bubbles = rows.map(({ c, v }) => ({ c, cx: x(v.priceChange ?? 0), cy: y(v.total > 0 ? v.short / v.total : 0.5), rr: r(v.total) }));
  for (const { c, cx, cy, rr } of bubbles.slice(0, LABELLED)) {
    const w = c.symbol.length * 6.4 + 4;
    for (const ty of [cy - rr - 3, cy + rr + 11]) {
      const box = { l: cx - w / 2, r: cx + w / 2, t: ty - 10, b: ty + 2 };
      if (box.t < PAD.t || box.b > PAD.t + ih) continue;
      const hitsLabel = boxes.some((o) => box.l < o.r && box.r > o.l && box.t < o.b && box.b > o.t);
      const hitsBubble = bubbles.some((o) => {
        if (o.c === c) return false;
        const nx = Math.max(box.l, Math.min(o.cx, box.r));
        const ny = Math.max(box.t, Math.min(o.cy, box.b));
        return Math.hypot(nx - o.cx, ny - o.cy) < o.rr;
      });
      if (!hitsLabel && !hitsBubble) {
        boxes.push(box);
        labels.set(c.symbol, { x: cx, y: ty });
        break;
      }
    }
  }

  return (
    <div ref={ref} className="relative mb-4 w-full">
      {width > 0 && rows.length > 0 && (
        <svg width={width} height={H} role="img" aria-label="Coins placed by price move and by which side was liquidated">
          {/* quadrant tints: squeeze top right, flush bottom left */}
          <rect x={x(0)} y={PAD.t} width={PAD.l + iw - x(0)} height={ih / 2} fill={SQUEEZE} opacity={0.06} />
          <rect x={PAD.l} y={PAD.t + ih / 2} width={x(0) - PAD.l} height={ih / 2} fill={FLUSH} opacity={0.06} />
          <line x1={x(0)} x2={x(0)} y1={PAD.t} y2={PAD.t + ih} stroke="var(--border)" />
          <line x1={PAD.l} x2={PAD.l + iw} y1={y(0.5)} y2={y(0.5)} stroke="var(--border)" />

          <text x={PAD.l + iw - 4} y={PAD.t + 12} textAnchor="end" fontSize={11} fontWeight={600} fill={SQUEEZE}>
            shorts squeezed
          </text>
          <text x={PAD.l + 4} y={PAD.t + ih - 6} fontSize={11} fontWeight={600} fill={FLUSH}>
            longs flushed
          </text>
          <text x={PAD.l + 4} y={PAD.t + 12} fontSize={10} fill="var(--text3)">
            shorts hit on a fall
          </text>
          <text x={PAD.l + iw - 4} y={PAD.t + ih - 6} textAnchor="end" fontSize={10} fill="var(--text3)">
            longs hit on a rise
          </text>

          {[...rows].reverse().map(({ c, v }) => {
            const share = v.total > 0 ? v.short / v.total : 0.5;
            const color = v.read === "squeeze" ? SQUEEZE : v.read === "flush" ? FLUSH : OTHER;
            const cx = x(v.priceChange ?? 0);
            const cy = y(share);
            return (
              <g key={c.symbol} onMouseEnter={() => setHover(c.symbol)} onMouseLeave={() => setHover(null)}>
                <circle cx={cx} cy={cy} r={r(v.total)} fill={color} fillOpacity={hover && hover !== c.symbol ? 0.25 : 0.7} stroke="var(--surface)" strokeWidth={1.5} />
                {labels.has(c.symbol) && (
                  <text x={labels.get(c.symbol)!.x} y={labels.get(c.symbol)!.y} textAnchor="middle" fontSize={10} fontWeight={600} fill="var(--text)">
                    {c.symbol}
                  </text>
                )}
                <circle cx={cx} cy={cy} r={Math.max(12, r(v.total))} fill="transparent" />
              </g>
            );
          })}

          <text x={PAD.l} y={H - 8} fontSize={10} fill="var(--text3)">
            price fell
          </text>
          <text x={PAD.l + iw / 2} y={H - 8} textAnchor="middle" fontSize={10} fill="var(--text3)">
            price change, {w}
          </text>
          <text x={PAD.l + iw} y={H - 8} textAnchor="end" fontSize={10} fill="var(--text3)">
            price rose
          </text>
        </svg>
      )}
      {hovered && (
        <div className="pointer-events-none absolute right-2 top-7 z-10 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 font-mono text-[10px] leading-relaxed text-[var(--text2)] shadow-sm">
          <div className="font-semibold text-[var(--text)]">{hovered.c.symbol}</div>
          <div>price {hovered.v.priceChange! >= 0 ? "+" : ""}{hovered.v.priceChange!.toFixed(1)}%</div>
          <div>longs forced out {usdCompact(hovered.v.long)}</div>
          <div>shorts forced out {usdCompact(hovered.v.short)}</div>
        </div>
      )}
      <p className="mt-1 text-[11px] leading-relaxed text-[var(--text3)]">
        Each bubble is a coin, sized by dollars liquidated. Up means shorts were forced out, down means
        longs. Hover a bubble for its numbers.
      </p>
    </div>
  );
}
