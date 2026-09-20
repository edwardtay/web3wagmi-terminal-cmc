#!/usr/bin/env node
// Snapshot CoinMarketCap's cross-exchange liquidation feed into a committed series.
//
// This exists because the API has no historical liquidation endpoint. It serves
// rolling 1h, 4h and 24h windows and nothing older, so a percentile can only
// rank against what has been collected since polling started. The terminal has
// no database and a deploy restarts the container, so holding the sample in
// process loses it exactly when it is needed: judging runs for two weeks after
// the last deploy.
//
// A file in the repo survives all of that, and it is also the evidence artefact
// the submission asks for, a public timestamped record of real API calls.
//
// Appends one JSON line per run to data/liquidations/<UTC date>.jsonl.
//
// Two credits a run. The global-metrics read alongside it is keyless and free,
// so adding it changed the cost by nothing.
//
// Usage: CMC_API_KEY=... node scripts/cmc-sample.mjs

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "https://pro-api.coinmarketcap.com";

// One file per UTC day rather than one growing file. A single appended file
// rewrites its whole blob into every commit, so 2,880 commits a month against
// a file heading for 10MB is a repository nobody wants to clone. Daily files
// cap each blob at about a megabyte and leave yesterday's untouched forever.
const day = new Date().toISOString().slice(0, 10);
const OUT = join(ROOT, "data", "liquidations", `${day}.jsonl`);

// Coins kept per sample. The feed returns 100 rows of ~918 and the point of the
// series is the shape of the large moves, so the tail is weight for nothing.
const KEEP_COINS = 25;

const key = process.env.CMC_API_KEY;
if (!key) {
  console.error("CMC_API_KEY is not set");
  process.exit(1);
}

/**
 * One call. Returns the envelope, or null on any failure.
 *
 * `error_code` comes back as a string on the v3 and v5 endpoints and as a
 * number on the v1 ones, so it is read loosely on purpose.
 */
async function get(path, keyless = false) {
  try {
    const res = await fetch(`${BASE}${keyless ? "/public-api" : ""}${path}`, {
      headers: keyless ? { Accept: "application/json" } : { "X-CMC_PRO_API_KEY": key, Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    const body = await res.json();
    if (!res.ok) {
      console.error(`[cmc-sample] ${path} HTTP ${res.status} ${body?.status?.error_message ?? ""}`);
      return null;
    }
    return body;
  } catch (e) {
    console.error(`[cmc-sample] ${path} ${e instanceof Error ? e.message : "failed"}`);
    return null;
  }
}

const int = (v) => Math.round(Number(v) || 0);

/**
 * A row's windows off its single-element `quotes` array, as `[total, long, short]`
 * in whole dollars. Cents on a nine-figure number are noise, and rounding here
 * is most of what keeps a month of samples down to single-digit megabytes.
 */
function windows(row, keep4h) {
  const q = row?.quotes?.[0];
  if (!q) return null;
  const out = {
    h1: [int(q.total_liquidations_1h), int(q.long_liquidations_1h), int(q.short_liquidations_1h)],
    h24: [int(q.total_liquidations_24h), int(q.long_liquidations_24h), int(q.short_liquidations_24h)],
  };
  // The 4h window is kept for the nine venues, which drive the concentration
  // read, and dropped for the coins, where it is 25 rows of weight the panel
  // never shows.
  if (keep4h) {
    out.h4 = [int(q.total_liquidations_4h), int(q.long_liquidations_4h), int(q.short_liquidations_4h)];
  }
  return out;
}

// Global metrics comes from the keyless mirror, so it costs nothing and does
// not compete with the liquidation reads for the free tier's 15,000 credits.
// It is here rather than in its own job because the percentile it feeds wants
// the same cadence, and a second workflow would double the Actions minutes for
// a call that is free.
const [exBody, coinBody, gmBody] = await Promise.all([
  get("/v5/derivatives/liquidations/exchange/list/latest"),
  get("/v5/derivatives/liquidations/cryptocurrency/list/latest"),
  get("/v1/global-metrics/quotes/latest", true),
]);

// A sample missing a side is worse than no sample: it would rank a partial
// market against full ones and read as a quiet hour. Skip the run instead.
if (!exBody?.data?.exchanges || !coinBody?.data?.cryptocurrencies) {
  console.error("[cmc-sample] incomplete read, nothing written");
  process.exit(1);
}

const exchanges = exBody.data.exchanges
  .map((x) => ({ id: x.exchange_id, n: x.name, ...windows(x, true) }))
  .filter((x) => x.h24);

const coins = coinBody.data.cryptocurrencies
  .map((x) => ({ id: x.crypto_id, s: x.symbol, ...windows(x, false) }))
  .filter((x) => x.h24)
  .sort((a, b) => b.h24[0] - a.h24[0])
  .slice(0, KEEP_COINS);

// What CoinMarketCap counted against what the venues claimed, per slice, in
// millions. Nothing else free publishes an adjusted figure beside a reported
// one, and the ratio between them is the only free wash-trading gauge there is.
// Null rather than absent when the read fails, so a gap in the series is
// visible instead of being read as a quiet day.
const gmq = gmBody?.data?.quote?.USD;
const m = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) / 1e6) : null);
const vol = gmq
  ? {
      total: [m(gmq.total_volume_24h), m(gmq.total_volume_24h_reported)],
      alt: [m(gmq.altcoin_volume_24h), m(gmq.altcoin_volume_24h_reported)],
      defi: [m(gmq.defi_volume_24h), m(gmq.defi_volume_24h_reported)],
      stable: [m(gmq.stablecoin_volume_24h), m(gmq.stablecoin_volume_24h_reported)],
      deriv: [m(gmq.derivatives_volume_24h), m(gmq.derivatives_volume_24h_reported)],
      mcap: m(gmq.total_market_cap),
      btcDom: gmq.btc_dominance ?? null,
    }
  : null;

const sample = {
  // Stamped by the sampler rather than taken from the payload, because the two
  // feeds carry their own last_updated and they do not always agree.
  t: new Date().toISOString(),
  // Credits this run actually cost, straight from the response envelopes, so
  // the ledger on the judge page is measured rather than asserted.
  cr: (exBody.status?.credit_count ?? 0) + (coinBody.status?.credit_count ?? 0),
  venues: exchanges.length,
  coinsTotal: coinBody.data.total_size ?? null,
  ex: exchanges,
  co: coins,
  vol,
};

await mkdir(dirname(OUT), { recursive: true });
await appendFile(OUT, JSON.stringify(sample) + "\n");

let lines = 0;
try {
  lines = (await readFile(OUT, "utf8")).trimEnd().split("\n").length;
} catch {
  // The count is a courtesy for the log. Not worth failing a good write over.
}

const total = exchanges.reduce((s, x) => s + x.h24[0], 0);
const top = exchanges.reduce((a, b) => (b.h24[0] > a.h24[0] ? b : a));
console.log(
  `[cmc-sample] ${sample.t} 24h $${total.toLocaleString()} across ${exchanges.length} venues, ` +
    `largest ${top.n} ${((100 * top.h24[0]) / (total || 1)).toFixed(1)}%, ` +
    `${sample.cr} credits, ${lines} samples held`
);
