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
import { liqSeries, percentile } from "@/lib/liqSeries";

// Forced selling across every venue CoinMarketCap tracks.
//
// The terminal has streamed Binance force orders since it shipped, which is one
// venue's share of an event that happens across the whole market. On 2026-09-20
// that share was 54.4% of the last twenty four hours, so the existing tape was
// showing about half of what happened and saying nothing about the rest.
//
// The reading this route exists for is not the dollar total. It is how far the
// selling spread: a $300M day on one venue is an exchange's liquidation engine
// and thin books, and the same $300M across nine is the market repricing. The
// effective venue count separates them and a dollar figure cannot.
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
const CACHE = 1200;

/** Windows the panel offers, and the field suffix each one reads. */
const WINDOWS = ["1h", "4h", "24h"] as const;
type Window = (typeof WINDOWS)[number];

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

interface CoinRow {
  id: number;
  symbol: string;
  name: string;
  rank: number;
  by: Record<Window, Split>;
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
    coverage: { venues: 0, coinsReturned: 0, coinsTotal: null, reads: 0, readFailures: 0 },
    credits: 0,
    budget: { monthly: BUDGET.monthly(revalidate, 3), routeAllowance: BUDGET.routeAllowance() },
  };
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
      streamedShare: streamed ? streamed.by[w].share : null,
    };
  }

  const coinRows: CoinRow[] = (coins?.cryptocurrencies ?? [])
    .map((c) => ({
      id: c.crypto_id,
      symbol: c.symbol,
      name: c.name,
      rank: c.cmc_rank,
      by: Object.fromEntries(WINDOWS.map((w) => [w, split(c.quotes?.[0] as never, w)])) as CoinRow["by"],
    }))
    .sort((a, b) => b.by["24h"].total - a.by["24h"].total)
    .slice(0, KEEP_COINS);

  const payload: ForcedPayload = {
    ok: true,
    asOf: (exchanges[0]?.quotes?.[0]?.last_updated as string) ?? new Date().toISOString(),
    failure: null,
    windows,
    venues: venueRows.sort((a, b) => b.by["24h"].total - a.by["24h"].total),
    coins: coinRows,
    sample: { n: series.points.length, from: series.from, to: series.to },
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
