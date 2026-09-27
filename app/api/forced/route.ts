import { jsonResponse } from "@/lib/http";
import {
  BUDGET,
  FAILURE_TEXT,
  cmcReady,
  coinLiquidations,
  concentration,
  marketLiquidations,
  venueLiquidations,
  type CallRecord,
  type CmcFailure,
} from "@/lib/cmc";
import { liqSeries, percentile, recordLiq } from "@/lib/liqSeries";
import { allTickers24h, windowTickers } from "@/lib/binance";

// Forced selling across every venue CoinMarketCap tracks.
//
// The terminal has streamed Binance force orders since it shipped, which is one
// venue's share of an event that happens across the whole market. On 2026-09-20
// that share was 54.4% of the last twenty four hours across the nine venues this
// feed covers. Those nine hold under half of the filtered open interest, so
// the tape saw nearer a quarter of the market; the panel states that coverage.
//
// What this route exists to measure is how far the selling spread. A $300M day
// on one venue is an exchange's liquidation engine and thin books; the same
// $300M across nine is the market repricing. The effective venue count
// separates them and a dollar figure cannot.
//
// Per house rule, that is ranked against its own history rather than printed as
// a level, and the history comes from `data/liquidations/`, because the API
// serves rolling windows and nothing older.

// Three calls a refresh at 1 credit each.
//
// BUDGET.monthly(1200, 3) is 6,480 credits a month, against the 12,120 that
// BUDGET.routeAllowance() leaves once the committed sampler has taken its
// 2,880 of the free tier's 15,000. /api/leverage takes 3,600 of the rest.
//
// That is the whole reason this window is 1200 and not 300: the same three
// calls at 300 seconds would be 25,920 a month, which is 73% over the entire
// free allowance on its own.
//
// Sized for the free Basic tier deliberately. The hackathon's Startup access
// ends when submissions close on 30 September and judging runs to 16 October,
// so a desk tuned to the event tier goes dark in the fortnight it is scored in.
export const revalidate = 1200;

// Rendered per request, with each upstream call held in the fetch cache for the
// window above, so the credit spend is unchanged. A prerendered route bakes in
// whatever the build read: one blip during a build served "CoinMarketCap did
// not answer" from /api/volume for a whole window after a clean deploy.
export const dynamic = "force-dynamic";
const CACHE = 1200;

/** Windows the panel offers, and the field suffix each one reads. */
const WINDOWS = ["1h", "4h", "24h"] as const;
type Window = (typeof WINDOWS)[number];

/** Readings of the collected series sent to the panel for its sparkline. */
const HISTORY_POINTS = 60;

/** Coins kept in the payload. The feed returns 100 of ~918 and the tail is noise. */
const KEEP_COINS = 30;

/**
 * The venue the terminal's own websocket covers, so the panel can mark the row
 * and state the gap rather than leaving a reader to spot it.
 */
const STREAMED_VENUE_ID = 270;

interface Split {
  total: number;
  long: number;
  short: number;
}

interface WindowRead extends Split {
  /** Share of the window's total on the largest single venue, 0 to 1. */
  largestShare: number;
  largestVenue: string;
  /** Inverse Herfindahl of liquidation value. Near 1 is one venue, near 9 is all of them. */
  effectiveVenues: number;
  /** The same number rescaled to 0 (even across venues) to 100 (all on one). */
  score: number;
  /** Where that score sits in the collected series, or null when the sample is too short. */
  scorePercentile: number | null;
  /** Where the window's total sits in the same series. Null under thirty samples. */
  totalPercentile: number | null;
  /** What the terminal's Binance-only tape would have shown for this window. */
  streamedShare: number | null;
}

interface VenueRow {
  id: number;
  name: string;
  /** Keyed by window, so the client switches without another request. */
  by: Record<Window, Split & { share: number }>;
  /** True for the venue the existing force-order stream covers. */
  streamed: boolean;
}

/**
 * What a coin's liquidations say once set beside its price over the same window.
 *
 * - `squeeze`: shorts carried most of it while the price rose. The forced
 *   buying is part of why it rose.
 * - `flush`: longs carried most of it while the price fell.
 * - `against`: the side that lost is the side the move favoured, longs
 *   liquidated into a rise or shorts into a fall. The window's net move hides
 *   a wick that went the other way first.
 * - `absorbed`: one side carried two thirds and the price barely moved, so the
 *   forced orders were taken without moving it.
 * - `two-sided`: neither side carried two thirds, so no side was forced out.
 */
export type LiqRead = "squeeze" | "flush" | "against" | "absorbed" | "two-sided";

interface CoinWindow extends Split {
  /** Binance spot price change over the same rolling window, in percent. Null when Binance does not list it. */
  priceChange: number | null;
  /** Null below the noise floor or without a price. */
  read: LiqRead | null;
}

interface CoinRow {
  id: number;
  symbol: string;
  name: string;
  rank: number;
  by: Record<Window, CoinWindow>;
}

export interface ForcedPayload {
  ok: boolean;
  asOf: string | null;
  /** Null when every read failed, so the panel can say which failure it was. */
  failure: string | null;
  windows: Record<Window, WindowRead> | null;
  venues: VenueRow[];
  coins: CoinRow[];
  /** The collected series behind the percentiles. A percentile with no stated sample is a decoration. */
  sample: { n: number; from: string | null; to: string | null };
  /**
   * The series itself, newest last, capped, so the panel can draw what it
   * ranks against. Concentration score and total per window.
   */
  history: Record<Window, { score: number[]; total: number[] }>;
  /**
   * What this refresh actually managed to read.
   *
   * A desk missing most of its venues renders exactly like a full one. That is
   * how the flow desk survived a load test and several deploys while serving
   * five series of fifty six, and it is why every read is counted here.
   */
  coverage: {
    venues: number;
    coinsReturned: number;
    coinsTotal: number | null;
    reads: number;
    readFailures: number;
  };
  /** Credits this refresh spent, measured from the response envelopes. */
  credits: number;
  budget: { monthly: number; routeAllowance: number };
}

function empty(failure: string | null): ForcedPayload {
  return {
    ok: false,
    asOf: null,
    failure,
    windows: null,
    venues: [],
    coins: [],
    sample: { n: 0, from: null, to: null },
    history: { "1h": { score: [], total: [] }, "4h": { score: [], total: [] }, "24h": { score: [], total: [] } },
    coverage: { venues: 0, coinsReturned: 0, coinsTotal: null, reads: 0, readFailures: 0 },
    credits: 0,
    budget: { monthly: BUDGET.monthly(revalidate, 3), routeAllowance: BUDGET.routeAllowance() },
  };
}

/** Share one side must carry before the window counts as that side being forced out. */
const DOMINANT = 2 / 3;

/**
 * Below this a window is a handful of positions, and one of them decides the
 * split. Most coins in the table clear it on 24h; on 1h many do not, and a
 * label on $40k would be reading noise.
 */
const READ_FLOOR_USD = 250_000;

/**
 * A move smaller than this, in percent, is flat for the window. One percent a
 * day scaled by the square root of time, since a move's typical size grows with
 * the root of the window. Without it BTC read "against the move" on a +0.04%
 * day with longs carrying 68%, which is a held price, not a reversal.
 */
const FLAT_PCT: Record<Window, number> = { "1h": 0.2, "4h": 0.4, "24h": 1 };

function classify(s: Split, priceChange: number | null, w: Window): LiqRead | null {
  if (priceChange == null || s.total < READ_FLOOR_USD) return null;
  const longShare = s.long / s.total;
  const shortShare = s.short / s.total;
  if (longShare < DOMINANT && shortShare < DOMINANT) return "two-sided";
  if (Math.abs(priceChange) < FLAT_PCT[w]) return "absorbed";
  const longsOut = longShare >= DOMINANT;
  const rose = priceChange > 0;
  if (longsOut) return rose ? "against" : "flush";
  return rose ? "squeeze" : "against";
}

/**
 * Binance spot price change per base symbol for each window, keyed by window.
 *
 * Free and keyless, so it adds nothing to the CoinMarketCap budget. The 24h
 * figure comes from the full board the other routes already hold in process;
 * 1h and 4h are one windowed request each for the listed symbols. Spot rather
 * than perps because the full spot board is what tells us which symbols exist,
 * and an unknown symbol fails the windowed request outright.
 */
async function priceMoves(bases: string[]): Promise<Record<Window, Map<string, number>>> {
  const out = { "1h": new Map(), "4h": new Map(), "24h": new Map() } as Record<Window, Map<string, number>>;
  const board = await allTickers24h(revalidate);
  if (!board) return out;
  const listed = new Map(board.map((t) => [t.symbol, t]));
  const pairs = bases.map((b) => [b, `${b}USDT`] as const).filter(([, sym]) => listed.has(sym));
  for (const [base, sym] of pairs) {
    const pct = Number(listed.get(sym)?.priceChangePercent);
    if (Number.isFinite(pct)) out["24h"].set(base, pct);
  }
  const symbols = pairs.map(([, sym]) => sym);
  const [h1, h4] = await Promise.all([windowTickers(symbols, "1h", revalidate), windowTickers(symbols, "4h", revalidate)]);
  for (const [w, rows] of [["1h", h1], ["4h", h4]] as const) {
    for (const r of rows ?? []) {
      const open = Number(r.openPrice);
      const last = Number(r.lastPrice);
      if (open > 0 && Number.isFinite(last)) out[w].set(r.symbol.replace(/USDT$/, ""), (100 * (last - open)) / open);
    }
  }
  return out;
}

/** A row's `[total, long, short]` for one window, off its single-element quotes array. */
function split(quote: Record<string, unknown> | undefined, w: Window): Split {
  const n = (k: string) => {
    const v = Number(quote?.[k]);
    return Number.isFinite(v) ? v : 0;
  };
  return {
    total: n(`total_liquidations_${w}`),
    long: n(`long_liquidations_${w}`),
    short: n(`short_liquidations_${w}`),
  };
}

export async function GET() {
  if (!cmcReady()) return jsonResponse(empty(FAILURE_TEXT["no-key"]), 60);

  // This route's own calls, not the process-wide ledger. The ledger is
  // cumulative across every route in the container, so counting it here would
  // have reported coverage this refresh never achieved.
  const calls: CallRecord[] = [];
  const opts = { revalidate, collect: calls };

  const [market, venues, coins, series] = await Promise.all([
    marketLiquidations(opts),
    venueLiquidations(opts),
    coinLiquidations(1, opts),
    liqSeries(),
  ]);

  const reads = calls.length;
  const readFailures = calls.filter((c) => c.failure).length;
  const credits = calls.reduce((s, c) => s + c.credits, 0);

  // The venue split is the only read this panel cannot do without. Everything
  // else degrades to a column rather than to a blank card.
  const exchanges = venues?.exchanges ?? [];
  if (!exchanges.length) {
    const failure = (calls.find((c) => c.failure)?.failure ?? "upstream") as CmcFailure;
    return jsonResponse({ ...empty(FAILURE_TEXT[failure]), coverage: { venues: 0, coinsReturned: 0, coinsTotal: null, reads, readFailures } }, 60);
  }

  const venueRows: VenueRow[] = exchanges.map((x) => ({
    id: x.exchange_id,
    name: x.name,
    streamed: x.exchange_id === STREAMED_VENUE_ID,
    by: {} as VenueRow["by"],
  }));

  const windows = {} as Record<Window, WindowRead>;

  for (const w of WINDOWS) {
    const perVenue = exchanges.map((x) => split(x.quotes?.[0] as never, w));
    const conc = concentration(perVenue.map((s) => s.total));

    exchanges.forEach((x, i) => {
      const s = perVenue[i];
      venueRows[i].by[w] = { ...s, share: conc?.total ? s.total / conc.total : 0 };
    });

    // The market-wide endpoint is the figure of record when it answers. The sum
    // of venues is the fallback, and the two agreed to within 0.3% when probed,
    // which is close enough to substitute and far enough to be worth not
    // silently mixing.
    const mw = market?.quotes?.[0] ? split(market.quotes[0] as never, w) : null;
    const totals: Split = mw ?? {
      total: conc?.total ?? 0,
      long: perVenue.reduce((s, v) => s + v.long, 0),
      short: perVenue.reduce((s, v) => s + v.short, 0),
    };

    const largestIdx = perVenue.reduce((best, s, i) => (s.total > perVenue[best].total ? i : best), 0);
    const streamed = venueRows.find((v) => v.streamed);

    windows[w] = {
      ...totals,
      largestShare: conc?.largestShare ?? 0,
      largestVenue: exchanges[largestIdx]?.name ?? "unknown",
      effectiveVenues: conc?.effectiveVenues ?? 0,
      score: conc?.score ?? 0,
      scorePercentile:
        conc == null
          ? null
          : percentile(
              conc.score,
              series.points.map((p) => p[w === "1h" ? "h1" : w === "4h" ? "h4" : "h24"]).filter((v): v is number => v != null)
            ),
      totalPercentile: percentile(
        totals.total,
        series.points.map((p) => p[w === "1h" ? "t1" : w === "4h" ? "t4" : "t24"]).filter((v): v is number => v != null)
      ),
      streamedShare: streamed ? streamed.by[w].share : null,
    };
  }

  // Ranked first, then recorded, so this reading never ranks against itself.
  // Only a read of every venue is recorded: a partial market would sit in the
  // series as a quiet hour, which is the same reason the sampler skips a run.
  if (exchanges.length >= 9) {
    await recordLiq({
      at: new Date().toISOString(),
      h1: windows["1h"].score,
      h4: windows["4h"].score,
      h24: windows["24h"].score,
      t1: windows["1h"].total,
      t4: windows["4h"].total,
      t24: windows["24h"].total,
    });
  }
  const sampleNow = await liqSeries();

  const kept = [...(coins?.cryptocurrencies ?? [])]
    .sort((a, b) => split(b.quotes?.[0] as never, "24h").total - split(a.quotes?.[0] as never, "24h").total)
    .slice(0, KEEP_COINS);
  const moves = await priceMoves(kept.map((c) => c.symbol));

  const coinRows: CoinRow[] = kept.map((c) => ({
    id: c.crypto_id,
    symbol: c.symbol,
    name: c.name,
    rank: c.cmc_rank,
    by: Object.fromEntries(
      WINDOWS.map((w) => {
        const s = split(c.quotes?.[0] as never, w);
        const priceChange = moves[w].get(c.symbol) ?? null;
        return [w, { ...s, priceChange, read: classify(s, priceChange, w) }];
      })
    ) as CoinRow["by"],
  }));

  const payload: ForcedPayload = {
    ok: true,
    asOf: (exchanges[0]?.quotes?.[0]?.last_updated as string) ?? new Date().toISOString(),
    failure: null,
    windows,
    venues: venueRows.sort((a, b) => b.by["24h"].total - a.by["24h"].total),
    coins: coinRows,
    sample: { n: sampleNow.points.length, from: sampleNow.from, to: sampleNow.to },
    history: Object.fromEntries(
      WINDOWS.map((w) => {
        const recent = sampleNow.points.slice(-HISTORY_POINTS);
        const sk = w === "1h" ? "h1" : w === "4h" ? "h4" : "h24";
        const tk = w === "1h" ? "t1" : w === "4h" ? "t4" : "t24";
        return [
          w,
          {
            score: recent.map((p) => p[sk]).filter((v): v is number => v != null),
            total: recent.map((p) => p[tk]).filter((v): v is number => v != null),
          },
        ];
      })
    ) as ForcedPayload["history"],
    coverage: {
      venues: exchanges.length,
      coinsReturned: coins?.cryptocurrencies?.length ?? 0,
      coinsTotal: coins?.total_size ?? null,
      reads,
      readFailures,
    },
    credits,
    budget: { monthly: BUDGET.monthly(revalidate, 3), routeAllowance: BUDGET.routeAllowance() },
  };

  return jsonResponse(payload, CACHE);
}
