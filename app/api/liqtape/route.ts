import { jsonResponse } from "@/lib/http";
import { ensureRecording, snapshot, type RecordedLiq } from "@/lib/liqRecorder";

// The recent Binance force orders the server has recorded, plus the shapes the
// liquidation charts draw: a per-minute long and short split for the last hour
// and a size distribution. Free: one websocket the container already holds, no
// metered upstream, so it is rendered per request with a short cache.
export const dynamic = "force-dynamic";

/** Prints sent for seeding the tape. The browser's own buffer holds 300. */
const SEED = 300;
const MINUTES = 60;

/** Size buckets in USD, lower bounds. Liquidation sizes span five orders of magnitude, so the edges are logarithmic. */
const EDGES = [0, 1_000, 10_000, 100_000, 1_000_000];

export interface LiqTapePayload {
  ok: boolean;
  status: string;
  /** When this container started recording, and when the current connection opened. */
  startedAt: string | null;
  connectedAt: string | null;
  /** Newest first, capped at SEED. */
  events: RecordedLiq[];
  /** Oldest first: one bar per minute for the last hour, USD. */
  minutes: { t: number; long: number; short: number; count: number }[];
  /** Counts and USD per size bucket, over everything recorded. */
  sizes: { from: number; to: number | null; count: number; usd: number }[];
  /** Totals over the whole recorded window. */
  window: { from: string | null; long: number; short: number; count: number };
}

export async function GET() {
  ensureRecording();
  const snap = snapshot();
  const ev = snap.events;

  const now = Date.now();
  const start = Math.floor((now - MINUTES * 60_000) / 60_000) * 60_000;
  const minutes = Array.from({ length: MINUTES + 1 }, (_, i) => ({ t: start + i * 60_000, long: 0, short: 0, count: 0 }));
  for (const e of ev) {
    if (e.ts < start) continue;
    const m = minutes[Math.min(MINUTES, Math.floor((e.ts - start) / 60_000))];
    m[e.side] += e.usd;
    m.count += 1;
  }

  const sizes = EDGES.map((from, i) => ({ from, to: EDGES[i + 1] ?? null, count: 0, usd: 0 }));
  for (const e of ev) {
    let i = EDGES.length - 1;
    while (i > 0 && e.usd < EDGES[i]) i--;
    sizes[i].count += 1;
    sizes[i].usd += e.usd;
  }

  const payload: LiqTapePayload = {
    ok: snap.status === "live" || ev.length > 0,
    status: snap.status,
    startedAt: snap.startedAt ? new Date(snap.startedAt).toISOString() : null,
    connectedAt: snap.connectedAt ? new Date(snap.connectedAt).toISOString() : null,
    events: ev.slice(-SEED).reverse(),
    minutes,
    sizes,
    window: {
      from: ev[0] ? new Date(ev[0].ts).toISOString() : null,
      long: ev.reduce((s, e) => s + (e.side === "long" ? e.usd : 0), 0),
      short: ev.reduce((s, e) => s + (e.side === "short" ? e.usd : 0), 0),
      count: ev.length,
    },
  };
  return jsonResponse(payload, 5);
}
