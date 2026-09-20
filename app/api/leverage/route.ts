import { jsonResponse } from "@/lib/http";
import {
  BUDGET,
  FAILURE_TEXT,
  cleanOpenInterest,
  cmcReady,
  coinLiquidations,
  coinOpenInterest,
  type CallRecord,
} from "@/lib/cmc";
import { MATRIX } from "@/lib/symbols";

// How much of the standing leverage a day's liquidations actually cleared.
//
// $40m liquidated on a coin carrying $180m of open interest is most of the book
// gone. The same $40m against $4bn is a rounding error. Every liquidation
// display ranks by dollar value, which mostly ranks by market cap and says
// nothing about damage. The ratio says something.
//
// The denominator is the part worth reading carefully. Open interest exists
// nowhere on the coin-level endpoints; it lives on market pairs, and CMC flags
// the pairs whose figures it does not stand behind with `outlier_detected` and
// a non-empty `exclusions`. Probed on 2026-09-20 for BTC, 54 of 100 pairs were
// flagged and they carried 60.7% of the $102bn reported. Dividing by the raw
// sum gave 0.058%; dividing by what CMC vouches for gave 0.149%.
//
// Both are published here, because the gap between them is the more interesting
// number. It is a vendor telling you which of its own inputs to distrust, and
// nothing else on this desk has an equivalent.

// One call per coin plus one for the liquidation board.
//
// MATRIX is nine symbols, so ten calls a refresh. BUDGET.monthly(7200, 10) is
// 3,600 credits a month. With /api/forced at 6,480 and the sampler at 2,880
// that is 12,960 of the free tier's 15,000, leaving about 2,000 for /status
// probes and the judge page.
//
// 7200 rather than 1200 because open interest is a stock rather than a flow:
// it moves over hours, and the numerator beside it already refreshes every
// twenty minutes on /api/forced. The same ten calls at 1200 seconds would be
// 21,600 credits a month, which is 44% over the entire free allowance on its
// own.
export const revalidate = 7200;
const CACHE = 7200;

export interface LeverageRow {
  symbol: string;
  /** 24h liquidation value across every venue CMC reports. */
  liquidated24h: number;
  long24h: number;
  short24h: number;
  /** Open interest on the pairs CMC vouches for. */
  openInterest: number;
  /** Open interest on the pairs CMC flags as outliers or excludes. */
  flaggedOpenInterest: number;
  cleanPairs: number;
  flaggedPairs: number;
  /**
   * Pairs this coin has, against the 100 the endpoint returns.
   *
   * The feed caps a page at 100 and sorts by 24h volume, so the denominator
   * below is the top 100 pairs rather than the whole book. Measured 2026-09-20:
   * BTC has 195 pairs and the unread tail held 4.1% more clean open interest,
   * ADA has 141 and held 1.7% more.
   *
   * Paging is supported and is not affordable. Nine coins past 100 pairs is up
   * to nine more calls a refresh, which would roughly double this route and put
   * the desk over the free tier's 15,000 a month. So the shortfall is reported
   * instead of hidden, because a Pairs cell reading "46 of 98" looks like the
   * whole book when the book is 195.
   */
  pairsTotal: number | null;
  /** Liquidated as a share of vouched-for open interest, 0 to 1. */
  clearedFraction: number | null;
  /** The same against the unfiltered sum, so the gap is visible. */
  clearedFractionUnfiltered: number | null;
  /** The venues holding the vouched-for open interest, largest first. */
  topVenues: { venue: string; openInterest: number }[];
}

export interface LeveragePayload {
  ok: boolean;
  asOf: string | null;
  failure: string | null;
  rows: LeverageRow[];
  /** Totals across the covered coins, for the headline. */
  totals: { openInterest: number; flaggedOpenInterest: number; liquidated24h: number } | null;
  coverage: { requested: number; priced: number; reads: number; readFailures: number };
  credits: number;
  budget: { monthly: number; routeAllowance: number };
}

function empty(failure: string | null, coverage?: LeveragePayload["coverage"]): LeveragePayload {
  return {
    ok: false,
    asOf: null,
    failure,
    rows: [],
    totals: null,
    coverage: coverage ?? { requested: MATRIX.length, priced: 0, reads: 0, readFailures: 0 },
    credits: 0,
    budget: { monthly: BUDGET.monthly(revalidate, MATRIX.length + 1), routeAllowance: BUDGET.routeAllowance() },
  };
}

export async function GET() {
  if (!cmcReady()) return jsonResponse(empty(FAILURE_TEXT["no-key"]), 60);

  // This route's own calls. The process-wide ledger is cumulative and shared
  // with /api/forced, so counting it here would overstate what this refresh
  // managed to read.
  const calls: CallRecord[] = [];
  const opts = { revalidate, collect: calls };

  // The liquidation board first, because it is one call covering every coin and
  // the per-coin numerator has to come from the same feed /api/forced uses, or
  // the two panels will disagree on screen.
  const board = await coinLiquidations(1, opts);

  const liqBySymbol = new Map<string, { total: number; long: number; short: number }>();
  for (const c of board?.cryptocurrencies ?? []) {
    const q = c.quotes?.[0];
    if (!q) continue;
    liqBySymbol.set(c.symbol, {
      total: q.total_liquidations_24h ?? 0,
      long: q.long_liquidations_24h ?? 0,
      short: q.short_liquidations_24h ?? 0,
    });
  }

  // Paced rather than fired at once. The plan allows 50 requests a minute and
  // this is ten, so the limit is not the constraint; the reason is the one the
  // flow desk learned the hard way, that a burst against a metered API is what
  // turns a working read into a throttled one, and there is nothing to gain
  // from arriving two seconds sooner on a two hour cache.
  const rows: LeverageRow[] = [];
  for (const symbol of MATRIX) {
    const oi = await coinOpenInterest(symbol, opts);
    const liq = liqBySymbol.get(symbol);

    if (!oi?.market_pairs?.length) {
      // A coin CMC cannot price is reported with a null ratio and counted,
      // rather than dropped. A table that silently omits its failures reads
      // like a complete one.
      rows.push({
        symbol,
        liquidated24h: liq?.total ?? 0,
        long24h: liq?.long ?? 0,
        short24h: liq?.short ?? 0,
        openInterest: 0,
        flaggedOpenInterest: 0,
        cleanPairs: 0,
        flaggedPairs: 0,
        pairsTotal: null,
        clearedFraction: null,
        clearedFractionUnfiltered: null,
        topVenues: [],
      });
      continue;
    }

    const { clean, flagged, cleanPairs, flaggedPairs, byVenue } = cleanOpenInterest(oi.market_pairs);
    const liquidated = liq?.total ?? 0;

    rows.push({
      symbol,
      liquidated24h: liquidated,
      long24h: liq?.long ?? 0,
      short24h: liq?.short ?? 0,
      openInterest: clean,
      flaggedOpenInterest: flagged,
      cleanPairs,
      flaggedPairs,
      pairsTotal: oi.num_market_pairs ?? null,
      clearedFraction: clean > 0 ? liquidated / clean : null,
      clearedFractionUnfiltered: clean + flagged > 0 ? liquidated / (clean + flagged) : null,
      topVenues: byVenue.slice(0, 5),
    });
  }

  const reads = calls.length;
  const readFailures = calls.filter((c) => c.failure).length;
  const priced = rows.filter((r) => r.clearedFraction != null).length;

  if (!priced) {
    const failure = calls.find((c) => c.failure)?.failure ?? "upstream";
    return jsonResponse(
      empty(FAILURE_TEXT[failure], { requested: MATRIX.length, priced: 0, reads, readFailures }),
      60
    );
  }

  const payload: LeveragePayload = {
    ok: true,
    asOf: new Date().toISOString(),
    failure: null,
    rows: rows.sort((a, b) => (b.clearedFraction ?? -1) - (a.clearedFraction ?? -1)),
    totals: {
      openInterest: rows.reduce((s, r) => s + r.openInterest, 0),
      flaggedOpenInterest: rows.reduce((s, r) => s + r.flaggedOpenInterest, 0),
      liquidated24h: rows.reduce((s, r) => s + r.liquidated24h, 0),
    },
    coverage: { requested: MATRIX.length, priced, reads, readFailures },
    credits: calls.reduce((s, c) => s + c.credits, 0),
    budget: { monthly: BUDGET.monthly(revalidate, MATRIX.length + 1), routeAllowance: BUDGET.routeAllowance() },
  };

  return jsonResponse(payload, CACHE);
}
