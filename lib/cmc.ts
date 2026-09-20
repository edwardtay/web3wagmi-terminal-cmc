import "server-only";
import { getJson } from "./http";

// The CoinMarketCap Pro API. The second keyed upstream on this desk, after The
// Graph, and read server-side like every other one.
//
// What it is here for is narrow. Prices, candles and market caps are already
// free from Binance and DefiLlama, so nothing load-bearing rests on those. The
// reason this file exists is the `/v5/derivatives/liquidations/*` family:
// liquidation totals aggregated across every derivatives venue CMC tracks,
// broken out per exchange and per coin. Binance publishes a force-order socket
// for Binance, Hyperliquid publishes Hyperliquid, and the terminal's own
// liquidation tape has seen one venue's share of a market-wide event since the
// day it shipped. On 2026-09-20 that share was 54.4% of the last 24 hours.
//
// Three things about this API are worth knowing before reading further, all
// established by probing rather than from the docs.
//
// 1. `error_code` is a string on the v3 and v5 endpoints and a number on the v1
//    ones. Never compare it with `===` against either.
// 2. Open interest does not exist on any coin-level or exchange-level endpoint.
//    It lives on market pairs, and CMC flags the pairs it does not vouch for
//    with `outlier_detected` and `exclusions`. For BTC those flagged pairs
//    carried 60.7% of reported open interest, so an unfiltered sum is wrong by
//    a factor of two and a half. See `cleanOpenInterest`.
// 3. There is no historical liquidation endpoint. Rolling 1h, 4h and 24h only.
//    The series in `data/liquidations/` is collected by `scripts/cmc-sample.mjs`
//    for that reason, and it is the only history this desk has.

const BASE = "https://pro-api.coinmarketcap.com";

/**
 * The keyless mirror of the same API.
 *
 * Prefixing a path with `/public-api` serves it without a credential and
 * without spending a credit. Verified on 2026-09-20: fear and greed, the CMC100
 * and CMC20 indices, the altcoin season index and global metrics all answer 200
 * with no key at all. The derivatives liquidation family does not, answering
 * 1005 "An API Key is required for this call".
 *
 * This matters for the budget rather than for convenience. The free Basic tier
 * allows 15,000 credits a month and the liquidation desks need most of them, so
 * anything reachable here is a panel that costs nothing and competes with
 * nothing. Reach for this first and fall back to the keyed base only when a
 * path refuses.
 */
const KEYLESS_BASE = "https://pro-api.coinmarketcap.com/public-api";

/**
 * Credits a call costs, measured from `status.credit_count` on a live key
 * rather than taken from the docs, which do not price the derivatives or key
 * endpoints at all.
 *
 * Every endpoint below cost exactly 1 except `/v1/key/info`, which is free.
 * The per-250-row multiplier the pricing page describes does not appear on any
 * of these, because none of them returns more than 100 rows a page.
 */
export const CREDITS_PER_CALL = 1;

/**
 * Budget, in the same shape as `lib/graph.ts` and for the same reason: a route
 * states its own monthly cost in a comment before it is added, and traffic never
 * enters the arithmetic, because a route with a `revalidate` window costs the
 * same for one visitor as for a thousand.
 *
 * The number to size against is 15,000 credits a month, which is the free Basic
 * allowance. Not the 450,000 the hackathon's Startup tier grants, because that
 * access ends when submissions close on 30 September and judging runs to 16
 * October. A desk tuned to Startup goes dark in the fortnight it is scored in.
 *
 * `scripts/cmc-sample.mjs` already spends 2,880 of the 15,000 at its thirty
 * minute cadence, so the routes share the 12,120 that are left.
 */
export const BUDGET = {
  /** The free tier's monthly allowance, which is what everything is sized for. */
  basicMonthlyCredits: 15_000,
  /** What the committed sampler spends: two calls every thirty minutes. */
  samplerMonthlyCredits: 2_880,
  /** Credits a month at a given refresh window. */
  monthly(revalidateSeconds: number, callsPerRefresh: number): number {
    return Math.round(((30 * 24 * 3600) / revalidateSeconds) * callsPerRefresh * CREDITS_PER_CALL);
  },
  /** What is left for the routes once the sampler has taken its share. */
  routeAllowance(): number {
    return this.basicMonthlyCredits - this.samplerMonthlyCredits;
  },
} as const;

/** Whether a key is configured. Callers degrade rather than throw when it is not. */
export function cmcReady(): boolean {
  return Boolean(process.env.CMC_API_KEY);
}

/** The envelope every endpoint returns, success or failure. */
export interface CmcEnvelope<T> {
  data: T;
  status: {
    timestamp: string;
    /** A string on v3 and v5, a number on v1. Read it loosely. */
    error_code: string | number;
    error_message: string | null;
    elapsed: number;
    credit_count: number;
    notice?: string | null;
  };
}

/**
 * What a failure meant, because these are not interchangeable to a reader.
 *
 * "Your plan does not carry this endpoint" and "you are over the minute limit"
 * are different facts, and a panel that renders one generic outage for both
 * tells nobody anything. A 403 carrying code 1006 in particular reads like a
 * malformed request until you know otherwise.
 */
export type CmcFailure =
  | "no-key"
  | "bad-key"
  | "plan"
  | "rate-minute"
  | "rate-daily"
  | "rate-monthly"
  | "upstream";

const FAILURE_BY_CODE: Record<string, CmcFailure> = {
  "1001": "bad-key",
  "1002": "no-key",
  "1006": "plan",
  "1008": "rate-minute",
  "1009": "rate-daily",
  "1010": "rate-monthly",
  "1011": "plan",
};

/** Plain words for a failure, for a panel to show instead of a blank card. */
export const FAILURE_TEXT: Record<CmcFailure, string> = {
  "no-key": "No CoinMarketCap key is configured.",
  "bad-key": "The CoinMarketCap key was refused.",
  plan: "This plan does not carry this endpoint.",
  "rate-minute": "Over the CoinMarketCap per-minute limit.",
  "rate-daily": "Over the CoinMarketCap daily credit limit.",
  "rate-monthly": "Over the CoinMarketCap monthly credit limit.",
  upstream: "CoinMarketCap did not answer.",
};

/**
 * The last call made against each path, for the judge page to render.
 *
 * Bounded by the number of distinct paths, which is fixed and small. This is the
 * "visible evidence of a real API call" requirement rendered as a product
 * feature rather than pasted into a README, and it is also the thing that tells
 * a deploy apart from a throttle: a desk missing half its reads looks exactly
 * like a working one, which this codebase has been caught by before.
 */
export interface CallRecord {
  path: string;
  /** The query string, so nine calls to one path are nine records rather than one. */
  query: string;
  status: number;
  elapsedMs: number;
  /** What the account was actually billed. */
  credits: number;
  /**
   * What the envelope said it cost, when that differs from what was billed.
   *
   * Only set on the keyless mirror, which reports 1 and charges 0.
   */
  claimedCredits?: number;
  at: string;
  failure: CmcFailure | null;
}

// Keyed by path and query together. Keying on the path alone collapsed the nine
// per-coin open interest reads into a single record, which made the credit
// total on the judge page read 2 where 10 were spent.
const ledger = new Map<string, CallRecord>();

/** Every call made since this process started, most recent first. */
export function callLedger(): CallRecord[] {
  return [...ledger.values()].sort((a, b) => b.at.localeCompare(a.at));
}

export interface CmcOptions {
  revalidate?: number;
  timeout?: number;
  /**
   * A route's own list of the calls it made.
   *
   * The ledger above is process-global and cumulative, which is right for the
   * judge page and wrong for a coverage counter: `/api/forced` would report the
   * reads `/api/leverage` had made in the same process and claim a coverage it
   * never had. A route passes its own array and counts that.
   */
  collect?: CallRecord[];
}

/**
 * One call against the Pro API. Returns `data`, or null on any failure, so every
 * caller degrades the same way.
 *
 * `getJson` drops the body on a non-2xx by default, and for this API the body
 * is where the useful part of a failure lives: a 401 carries `error_code: 1001`
 * and a 403 carries `1006`, which are "the key was refused" and "this plan does
 * not carry this endpoint". So `keepErrorBody` is passed and the envelope is
 * read whatever the status was.
 */
export async function cmcGet<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
  opts: CmcOptions = {}
): Promise<T | null> {
  const key = process.env.CMC_API_KEY;
  const at = new Date().toISOString();

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") qs.set(k, String(v));
  }
  const query = qs.toString();

  const note = (rec: CallRecord) => {
    ledger.set(`${path}?${query}`, rec);
    opts.collect?.push(rec);
    return rec;
  };

  if (!key) {
    note({ path, query, status: 0, elapsedMs: 0, credits: 0, at, failure: "no-key" });
    return null;
  }

  const body = await getJson<CmcEnvelope<T>>(`${BASE}${path}${query ? `?${query}` : ""}`, {
    revalidate: opts.revalidate ?? 1800,
    timeout: opts.timeout ?? 20_000,
    headers: { "X-CMC_PRO_API_KEY": key },
    keepErrorBody: true,
  });

  if (!body || !body.status) {
    note({ path, query, status: 0, elapsedMs: 0, credits: 0, at, failure: "upstream" });
    return null;
  }

  // A string on v3 and v5, a number on v1, so it is coerced before comparison.
  const code = String(body.status.error_code ?? "0");
  const failure = code === "0" ? null : (FAILURE_BY_CODE[code] ?? "upstream");
  note({
    path,
    query,
    status: failure ? 0 : 200,
    elapsedMs: body.status.elapsed ?? 0,
    credits: body.status.credit_count ?? 0,
    at,
    failure,
  });

  return failure ? null : (body.data ?? null);
}

/**
 * One call against the keyless mirror. No key, no credit, same envelope.
 *
 * Still recorded in the ledger, with zero credits, because the judge page
 * should show that these calls happen and that they cost nothing. A panel whose
 * cost is invisible is one nobody can budget around.
 */
export async function cmcGetFree<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
  opts: CmcOptions = {}
): Promise<T | null> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") qs.set(k, String(v));
  }
  const query = qs.toString();
  const at = new Date().toISOString();

  const body = await getJson<CmcEnvelope<T>>(`${KEYLESS_BASE}${path}${query ? `?${query}` : ""}`, {
    revalidate: opts.revalidate ?? 1800,
    timeout: opts.timeout ?? 20_000,
    keepErrorBody: true,
  });

  const code = body?.status ? String(body.status.error_code ?? "0") : "x";
  const failure = code === "0" ? null : (FAILURE_BY_CODE[code] ?? "upstream");
  const rec: CallRecord = {
    path: `/public-api${path}`,
    query,
    status: failure ? 0 : 200,
    elapsedMs: body?.status?.elapsed ?? 0,
    // Zero, not what the envelope says.
    //
    // The keyless mirror returns `credit_count: 1` and charges nothing. Tested
    // 2026-09-20: six calls through `/public-api` moved the account ledger from
    // 93 to 93. There is no key on the request, so there is no account to bill;
    // the field looks like it is copied from the keyed path.
    //
    // Reporting the envelope's number would put a cost on the judge page that
    // the account never paid and would make the budget arithmetic wrong in the
    // direction that matters, by overstating what is left.
    credits: 0,
    // What it claimed, kept so the discrepancy is visible rather than silently
    // corrected. A number quietly overridden is one nobody can check.
    claimedCredits: body?.status?.credit_count ?? 0,
    at,
    failure,
  };
  ledger.set(`/public-api${path}?${query}`, rec);
  opts.collect?.push(rec);

  return failure ? null : (body?.data ?? null);
}

/**
 * The same call, handing back the whole envelope instead of just `data`.
 *
 * The evidence page prints a real request and its real response, including the
 * `status` block carrying `credit_count` and `elapsed`. A submission that
 * describes what an API can do is not evidence that it was called, and a
 * `credit_count` coming back from the vendor is the one part of that claim a
 * reader can check against their own dashboard.
 *
 * Deliberately separate from `cmcGet` rather than an option on it, so no panel
 * can accidentally start holding whole envelopes in memory for a payload it
 * only reads three fields from.
 */
export async function cmcRaw<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
  opts: CmcOptions = {}
): Promise<{ url: string; envelope: CmcEnvelope<T> | null }> {
  const key = process.env.CMC_API_KEY;

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") qs.set(k, String(v));
  }
  const query = qs.toString();
  // The key never appears in this. It travels on a header, which is also why
  // the URL is safe to print on a public page.
  const url = `${BASE}${path}${query ? `?${query}` : ""}`;

  if (!key) return { url, envelope: null };

  const envelope = await getJson<CmcEnvelope<T>>(url, {
    revalidate: opts.revalidate ?? 3600,
    timeout: opts.timeout ?? 20_000,
    headers: { "X-CMC_PRO_API_KEY": key },
    keepErrorBody: true,
  });

  if (envelope?.status) {
    const code = String(envelope.status.error_code ?? "0");
    const failure = code === "0" ? null : (FAILURE_BY_CODE[code] ?? "upstream");
    const rec: CallRecord = {
      path,
      query,
      status: failure ? 0 : 200,
      elapsedMs: envelope.status.elapsed ?? 0,
      credits: envelope.status.credit_count ?? 0,
      at: new Date().toISOString(),
      failure,
    };
    ledger.set(`${path}?${query}`, rec);
    opts.collect?.push(rec);
  }

  return { url, envelope };
}

// ---- volume quality ------------------------------------------------------

/**
 * Global metrics, keyless and free.
 *
 * The pair worth having is `*_volume_24h` against `*_volume_24h_reported`:
 * what CoinMarketCap counts, against what the venues claimed. Nothing else free
 * publishes an adjusted figure beside the reported one, so the gap between them
 * is a wash-trading gauge no other source can give.
 *
 * Measured 2026-09-20: $70.5bn counted against $435.7bn reported, so 83.8% of
 * the world's printed spot volume was discarded. The slices differ sharply and
 * that difference is the reading: derivatives came in at 1.04x while spot was
 * 6.18x, which says the inflation lives on spot books rather than in perps.
 */
export interface GlobalMetrics {
  btc_dominance: number;
  eth_dominance: number;
  quote: {
    USD: {
      total_market_cap: number;
      total_volume_24h: number;
      total_volume_24h_reported: number;
      altcoin_volume_24h: number;
      altcoin_volume_24h_reported: number;
      altcoin_market_cap: number;
      defi_volume_24h: number;
      defi_volume_24h_reported: number;
      stablecoin_volume_24h: number;
      stablecoin_volume_24h_reported: number;
      stablecoin_market_cap: number;
      derivatives_volume_24h: number;
      derivatives_volume_24h_reported: number;
      last_updated: string;
    };
  };
}

/** Global metrics. Keyless, so 0 credits. */
export function globalMetrics(opts: CmcOptions = {}) {
  return cmcGetFree<GlobalMetrics>("/v1/global-metrics/quotes/latest", {}, opts);
}

// ---- liquidations --------------------------------------------------------

/**
 * Every liquidation row nests its figures in a one-element `quotes` array, on
 * the market-wide, per-exchange and per-coin endpoints alike.
 */
export interface LiquidationQuote {
  symbol: string;
  crypto_id: number;
  total_liquidations_1h: number;
  long_liquidations_1h: number;
  short_liquidations_1h: number;
  total_liquidations_4h: number;
  long_liquidations_4h: number;
  short_liquidations_4h: number;
  total_liquidations_24h: number;
  long_liquidations_24h: number;
  short_liquidations_24h: number;
  last_updated: string;
}

export interface VenueLiquidations {
  name: string;
  slug: string;
  exchange_id: number;
  quotes: LiquidationQuote[];
}

export interface CoinLiquidations {
  name: string;
  symbol: string;
  slug: string;
  crypto_id: number;
  cmc_rank: number;
  quotes: LiquidationQuote[];
}

/** Market-wide totals over the three rolling windows. 1 credit. */
export function marketLiquidations(opts: CmcOptions = {}) {
  return cmcGet<{ quotes: LiquidationQuote[] }>("/v5/derivatives/liquidations/quotes/latest", {}, opts);
}

/**
 * The per-venue split. 1 credit.
 *
 * Returns exactly nine venues and is not paginated: Binance, Gate, OKX, Bybit,
 * Hyperliquid, HTX, Aster, Kraken, Bitfinex. A `limit` parameter does not widen
 * it. Nine is the universe, so a share computed against their sum is a share of
 * everything this API can see, which is the honest framing and the one the panel
 * uses.
 */
export function venueLiquidations(opts: CmcOptions = {}) {
  return cmcGet<{ exchanges: VenueLiquidations[]; total_size: number; has_more: boolean }>(
    "/v5/derivatives/liquidations/exchange/list/latest",
    {},
    opts
  );
}

/**
 * The per-coin split. 1 credit a page.
 *
 * 100 rows of about 918, paginated with `start`. `limit` above 100 answers 400
 * "Invalid parameter", so paging is the only way down the tail, and the first
 * page holds every coin that matters for a cascade.
 */
export function coinLiquidations(start = 1, opts: CmcOptions = {}) {
  return cmcGet<{ cryptocurrencies: CoinLiquidations[]; total_size: number; has_more: boolean }>(
    "/v5/derivatives/liquidations/cryptocurrency/list/latest",
    { start },
    opts
  );
}

// ---- open interest -------------------------------------------------------

export interface MarketPair {
  market_id: number;
  market_pair_symbol: string;
  category: string;
  /** CMC's own judgement that this pair's figures are off. */
  outlier_detected: boolean;
  /** Which fields CMC excludes from its aggregates. Seen: "price", "volume". */
  exclusions: string[];
  exchange?: { exchange_id: number; exchange_name: string; exchange_slug: string };
  market_pair_base: { crypto_id: number; symbol: string };
  quotes: { convert_id: number; price: number; volume_24h: number; open_interest: number | null }[];
}

/**
 * Open interest for one coin across every venue that lists it. 1 credit.
 *
 * This is the cheap single-vendor denominator: one call returned 100 pairs
 * across 84 venues for BTC, each with open interest, funding rate and index
 * price. The endpoint answers 400 without one of `crypto_id`, `crypto_symbol`
 * or `crypto_slug`, so there is no way to sweep every coin at once.
 */
export function coinOpenInterest(symbol: string, opts: CmcOptions = {}) {
  return cmcGet<{ crypto_id: number; symbol: string; num_market_pairs: number; market_pairs: MarketPair[] }>(
    "/v5/cryptocurrency/derivatives/market-pairs/list/latest",
    { crypto_symbol: symbol },
    opts
  );
}


/**
 * Sum open interest across pairs, separating what CMC vouches for from what it
 * does not.
 *
 * This split is the most useful thing in the whole API and it is not documented
 * as a feature. Probed on 2026-09-20 for BTC: 54 of 100 pairs carried
 * `outlier_detected` or a non-empty `exclusions`, and those pairs held 60.7% of
 * the $102bn of reported open interest. BTCC, CoinW, BitMart and FameEX each
 * claimed five to nine billion, and CMC marks all of them.
 *
 * Dividing 24h liquidations by the unfiltered sum gave 0.058%. Dividing by the
 * clean sum gave 0.149%. Every liquidation dashboard that ranks by dollars and
 * normalises by raw open interest is off by that factor, so both numbers are
 * returned and the panel shows both.
 */
export function cleanOpenInterest(pairs: MarketPair[]): {
  clean: number;
  flagged: number;
  cleanPairs: number;
  flaggedPairs: number;
  byVenue: { venue: string; openInterest: number }[];
} {
  let clean = 0;
  let flagged = 0;
  let cleanPairs = 0;
  let flaggedPairs = 0;
  const venues = new Map<string, number>();

  for (const p of pairs) {
    // Perpetuals and futures only. A spot pair has no open interest and would
    // be a silent zero in the denominator.
    const oi = p.quotes?.[0]?.open_interest ?? 0;
    if (!oi) continue;
    if (p.outlier_detected || p.exclusions?.length) {
      flagged += oi;
      flaggedPairs += 1;
      continue;
    }
    clean += oi;
    cleanPairs += 1;
    const name = p.exchange?.exchange_name ?? "unknown";
    venues.set(name, (venues.get(name) ?? 0) + oi);
  }

  return {
    clean,
    flagged,
    cleanPairs,
    flaggedPairs,
    byVenue: [...venues.entries()]
      .map(([venue, openInterest]) => ({ venue, openInterest }))
      .sort((a, b) => b.openInterest - a.openInterest),
  };
}

// ---- the key ledger ------------------------------------------------------


/** The live credit ledger. Free, and the one number a judge can check for themselves. */
export function keyInfo(opts: CmcOptions = {}) {
  return cmcGet<{
    plan: { credit_limit_monthly: number; credit_limit_monthly_reset: string; rate_limit_minute: number };
    usage: {
      current_minute: { requests_made: number; requests_left: number };
      current_day: { credits_used: number };
      current_month: { credits_used: number; credits_left: number };
    };
  }>("/v1/key/info", {}, opts);
}

// ---- concentration -------------------------------------------------------

/**
 * How concentrated a round of liquidations was across venues.
 *
 * A $400M hour on one venue and a $400M hour spread across nine are different
 * events, and a dollar total cannot tell them apart. The effective venue count
 * is the inverse Herfindahl of liquidation value: near 1 means one exchange's
 * book broke, near 9 means the market repriced.
 *
 * `score` rescales the Herfindahl so that 0 is perfectly even across the whole
 * venue set and 100 is all of it on one. It is a monotone presentation of the
 * same number, and the panel shows the effective count beside it rather than
 * leading with the score alone, because a 0 to 100 reading with no units
 * invites being read as a percentage.
 *
 * Per house rule, this is ranked against its own history rather than shown as a
 * level, and that history comes from `data/liquidations/`.
 */
export function concentration(values: number[]): {
  total: number;
  largestShare: number;
  effectiveVenues: number;
  score: number;
} | null {
  const vs = values.filter((v) => v > 0);
  const total = vs.reduce((s, v) => s + v, 0);
  if (!total || vs.length < 2) return null;

  const shares = vs.map((v) => v / total);
  const hhi = shares.reduce((s, x) => s + x * x, 0);

  // The universe, including venues that printed nothing this window.
  //
  // This used to be vs.length, the count that printed, and that made the score
  // depend on how many venues happened to be quiet rather than only on how the
  // selling was distributed. Two consequences, both real.
  //
  // It stopped being monotone: [80,20] scored 36 while [80,20,1,1,1,1,1,1,1],
  // a materially less concentrated market, scored 54. And because liqSeries
  // feeds these scores into the series that /api/forced percentile-ranks, a
  // window where two venues were quiet was being ranked against one where all
  // nine printed, on a different scale.
  //
  // A zero contributes nothing to the Herfindahl either way, so only the
  // rescale moves. vs.length >= 2 is already guaranteed above and values.length
  // is at least that, so the denominator cannot vanish.
  const n = values.length;

  return {
    total,
    largestShare: Math.max(...shares),
    effectiveVenues: 1 / hhi,
    score: Math.round((100 * (hhi - 1 / n)) / (1 - 1 / n)),
  };
}
