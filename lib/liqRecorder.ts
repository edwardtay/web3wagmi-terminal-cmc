import "server-only";

// Binance force orders, recorded by the server so the tape is never empty.
//
// The liquidation tape used to be a browser websocket with a ring buffer, which
// meant every page load started at zero and a quiet market showed "Waiting for
// the first print" for minutes. The container now holds one connection to the
// same stream and keeps the recent prints, and the browser seeds its tape from
// /api/liqtape before the live socket takes over. One upstream connection
// serves every reader, and it is server-side like every other upstream call.
//
// The stream pushes at most the largest force order per symbol per second
// (the latest until Binance changed it on 2026-04-14), so
// this is a snapshot tape rather than every fill, exactly as the browser saw it.
// It is lost on restart, so a fresh container starts empty and fills forward.

const WS_URL = "wss://fstream.binance.com/market/ws/!forceOrder@arr";

/** How far back the buffer reaches, and a hard cap for a violent hour. */
const KEEP_MS = 6 * 60 * 60 * 1000;
const CAP = 5000;

export interface RecordedLiq {
  ts: number;
  symbol: string;
  /** A forced SELL closes a long, so "long" means a long was liquidated. */
  side: "long" | "short";
  qty: number;
  price: number;
  usd: number;
}

type Status = "idle" | "connecting" | "live" | "down" | "unsupported";

const buffer: RecordedLiq[] = [];
let status: Status = "idle";
let connectedAt: number | null = null;
let startedAt: number | null = null;
let attempts = 0;

function parse(raw: unknown): RecordedLiq | null {
  if (!raw || typeof raw !== "object") return null;
  const outer = raw as Record<string, unknown>;
  const msg = (outer.data && typeof outer.data === "object" ? outer.data : outer) as Record<string, unknown>;
  if (msg.e !== "forceOrder") return null;
  const o = msg.o as Record<string, unknown> | undefined;
  if (!o || typeof o.s !== "string") return null;
  const filled = Number(o.z ?? o.q);
  const q = Number.isFinite(filled) && filled > 0 ? filled : Number(o.q);
  const avg = Number(o.ap);
  const px = Number.isFinite(avg) && avg > 0 ? avg : Number(o.p);
  if (!Number.isFinite(q) || !Number.isFinite(px) || q <= 0 || px <= 0) return null;
  const ts = Number(o.T ?? msg.E);
  return {
    ts: Number.isFinite(ts) ? ts : Date.now(),
    symbol: o.s,
    side: o.S === "SELL" ? "long" : "short",
    qty: q,
    price: px,
    usd: q * px,
  };
}

function trim() {
  const floor = Date.now() - KEEP_MS;
  let drop = 0;
  while (drop < buffer.length && buffer[drop].ts < floor) drop++;
  if (buffer.length - drop > CAP) drop = buffer.length - CAP;
  if (drop > 0) buffer.splice(0, drop);
}

function connect() {
  if (typeof WebSocket === "undefined") {
    // Node 20 has no global WebSocket without --experimental-websocket. The
    // container runs Node 22, where it is built in.
    status = "unsupported";
    return;
  }
  status = "connecting";
  let sock: WebSocket;
  try {
    sock = new WebSocket(WS_URL);
  } catch {
    retry();
    return;
  }
  sock.onopen = () => {
    attempts = 0;
    status = "live";
    connectedAt = Date.now();
  };
  sock.onmessage = (ev) => {
    try {
      const data = JSON.parse(String(ev.data));
      for (const item of Array.isArray(data) ? data : [data]) {
        const e = parse(item);
        if (e) buffer.push(e);
      }
      trim();
    } catch {
      // A malformed frame should not end the recording.
    }
  };
  sock.onerror = () => sock.close();
  sock.onclose = () => {
    status = "down";
    connectedAt = null;
    retry();
  };
}

function retry() {
  attempts += 1;
  // 1s doubling to a 60s ceiling, so an outage does not hammer Binance.
  const wait = Math.min(60_000, 1000 * 2 ** Math.min(attempts - 1, 6));
  setTimeout(connect, wait).unref?.();
}

/** Start recording once per process. Safe to call on every request. */
export function ensureRecording(): void {
  if (startedAt != null) return;
  startedAt = Date.now();
  connect();
}

export function snapshot(): {
  status: Status;
  startedAt: number | null;
  connectedAt: number | null;
  events: RecordedLiq[];
} {
  trim();
  return { status, startedAt, connectedAt, events: buffer.slice() };
}
