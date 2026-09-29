# Where the API got in the way

Everything here was found by probing a live key on the free Basic tier between 20 and 21 September
2026, while building the panels this repository ships. Each item says what happened, what it
cost, and what would have prevented it. Ordered by how much time it took.

## 1. Open interest cannot be swept

`/v5/cryptocurrency/derivatives/market-pairs/list/latest` is the only place open interest exists.
It is on no coin-level endpoint, and it requires one of `crypto_id`, `crypto_symbol` or
`crypto_slug`, answering 400 without one:

```
"'value' must contain at least one of [crypto_id, crypto_symbol, crypto_slug]"
```

So pricing N coins costs N calls. On the free tier's 15,000 credits a month that is the single
constraint that shaped this project: nine coins at a two hour refresh is 3,600 credits, and any
shorter window or wider universe does not fit.

**What would fix it:** an `open_interest` field on
`/v5/derivatives/liquidations/cryptocurrency/list/latest`, which already returns 100 coins for one
credit. The two numbers are read together far more often than either is read alone. A liquidation
figure without the open interest behind it cannot say whether a book was cleared or scratched.

## 2. There is no historical liquidation endpoint

The liquidation family serves rolling 1h, 4h and 24h windows and nothing older. There is no
`/historical` variant, and no way to ask what yesterday looked like.

That means a percentile, a sigma, or any statement of the form "this is unusual" has to be built on
a series the caller collects themselves. This repository targets a GitHub Action every thirty minutes, with actual scheduling gaps
for exactly that reason, and it cannot be backfilled: the series starts the day you start asking.

**What would fix it:** an hourly or daily history, even a short one. Thirty days would be enough to
say whether an hour is unusual, which is the only thing most readers want from a liquidation
figure.

## 3. `error_code` changes type between API versions

The v3 and v5 endpoints return it as a **string**. The v1 endpoints return it as a **number**.

```
/v5/derivatives/liquidations/quotes/latest   →  "error_code":"1002"
/v1/key/info                                 →  "error_code":1002
/v2/cryptocurrency/ohlcv/historical          →  "error_code":1006
```

A client comparing with `===`, or any typed language modelling the envelope once, breaks on
whichever half it was not written against. `lib/cmc.ts` coerces with `String()` and says why in a
comment.

**What would fix it:** pick one. A number is the better choice, and the string form looks like the
accident.

## 4. `1006` arrives as a 403 and reads like a bad request

Calling a plan-gated endpoint returns HTTP 403 with:

```json
{"error_code":1006,"error_message":"Your API Key subscription plan doesn't support this endpoint."}
```

The message is clear once read. The 403 is not, because 403 is also what a malformed or unauthorised
request returns, so the first instinct is to check the request rather than the plan. This cost
real time on `/v2/cryptocurrency/ohlcv/historical`.

**What would fix it:** 402 Payment Required, or 403 with a `required_plan` field, so a client can
render "upgrade to Hobbyist" rather than a generic outage. `lib/cmc.ts` maps five codes to distinct
user-facing messages because those are five genuinely different facts for a reader.

## 5. Pagination limits are undiscoverable until you exceed them

`limit=500` on the coin liquidation endpoint returns:

```
"Invalid parameter."
```

No maximum, no field name, nothing to act on. The real cap is 100, found by bisection. By contrast
`/v3/index/cmc100-historical` gets this exactly right:

```
"'count' should be a positive number in range [1, 10]"
```

That message is worth copying everywhere.

## 6. `/v5/exchange/derivatives/list` returns no `total_size`

The liquidation endpoints return `total_size` and `has_more`, which is all a caller needs. This one
returns neither, so there is no way to know how many pages exist without walking until a page comes
back short. Bitfinex, one of the nine venues in the liquidation feed, sits on page 2, so a naive
single-page join silently drops it.

**What would fix it:** `total_size` and `has_more` on every paginated endpoint, the way the v5
liquidation endpoints already do it.

## 7. The derivatives and key endpoints have no published credit cost

The pricing page prices the v1 and v2 catalogue. It does not price `/v5/derivatives/*`,
`/v5/exchange/derivatives/*`, `/v3/index/*` or `/v1/key/info`. The only way to budget was to call
each one and read `status.credit_count` back.

They all cost 1, except `/v1/key/info` which is free. That is good news and it should be written
down, because a developer sizing a refresh window against an unpublished cost either over-caches or
burns their month.

## 8. `outlier_detected` and `exclusions` are the best thing here and are not documented as a feature

Every market pair carries `outlier_detected` and an `exclusions` array. Across the nine largest
coins, pairs carrying one or the other hold **52% of all reported open interest**. For Bitcoin it
is 61%: BTCC, CoinW, BitMart and FameEX each report five to nine billion dollars of BTC open
interest, and CoinMarketCap flags all of them.

Filtering on those fields moves Bitcoin's 24h liquidation-to-open-interest ratio from 0.061% to
0.158%, a factor of 2.6. This demonstrates sensitivity to filtering, not that the unfiltered
open interest is wrong. The exclusions concern price and volume, not verification of open interest.

A worked example should explain exactly which fields each flag applies to. A filter for pairs
without price/volume exclusions could help exploration, provided it does not imply that their
open interest has been verified.

## 9. The keyless mirror reports a credit cost it does not charge

Prefixing a path with `/public-api` serves it without a credential. Verified working for
`/v3/fear-and-greed/latest`, `/v3/index/cmc100-latest`, `/v1/altcoin-season-index/latest` and
`/v1/global-metrics/quotes/latest`. This is excellent and underadvertised.

The envelope, though, still reports a cost:

```json
{"error_code":0,"elapsed":1,"credit_count":1}
```

Six calls through `/public-api` moved the account's `credits_used` from 93 to 93. There is no key
on the request, so there is no account to bill, and the field appears to be carried over from the
keyed path.

An app that budgets from `credit_count`, which is the only way to budget given item 7, will
therefore overstate its own spend and under-use the plan it paid for. `credit_count: 0` on the
keyless mirror would fix it.

## 10. `/v1/cryptocurrency/map` answers 200 with no key at all

Every other endpoint returns 1002 "API key missing". This one returns the full map unauthenticated.
Probably deliberate, but it is surprising, and it is the sort of surprise that turns into an
unintended dependency.

## 11. The nine-venue liquidation universe is not stated anywhere

`/v5/derivatives/liquidations/exchange/list/latest` returns exactly nine venues with
`total_size: 9` and `has_more: false`. That is answerable from the payload, which is good. What is
not answerable is whether nine is the design or the current state, which matters for anyone
computing a share: a share of nine venues is a different claim from a share of the market.

**What would fix it:** one line in the docs saying which venues the liquidation feed covers and how
that list changes.

## 12. Documented paths span v1 to v5 while deprecated versions still answer

`/v1`, `/v2`, `/v3` and `/v5` are all live, and for some resources more than one version answers.
Choosing the right path meant reading four sections of the reference and testing. A single
"current endpoint for this resource" column would remove the guesswork.

---

## What worked well, since the ask was for both

- **`status.credit_count` on every response.** Being able to measure cost rather than infer it is
  the reason this project could publish a credit budget at all. Cross-checked against the account
  dashboard and it matched exactly.
- **`/v1/key/info` costing nothing.** It means an app can show its own usage honestly without the
  telemetry changing the number.
- **The liquidation family being free on Basic.** Cross-venue liquidation data is sold elsewhere.
  Giving it away at 1 credit a call is the reason this project exists, and it is the most
  underrated thing in the catalogue.
- **Error messages carrying a real explanation** where they exist, as in the `[1, 10]` range
  message. The gap is that not every endpoint does it.
