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
// Appends one JSON line per run to data/liquidations.jsonl. Two credits a run.
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
async function get(path) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { "X-CMC_PRO_API_KEY": key, Accept: "application/json" },
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

const [exBody, coinBody] = await Promise.all([
  get("/v5/derivatives/liquidations/exchange/list/latest"),
  get("/v5/derivatives/liquidations/cryptocurrency/list/latest"),
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
