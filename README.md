# web3wagmi terminal: checking the inputs changes the answer

A live crypto terminal with a new CoinMarketCap integration for the **Build with CMC: API
Hackathon**, **Data and Visualisation** track.

**[Try the complete CMC demo](https://terminal.web3wagmi.com/cmc)** · **[Judge's guide](JUDGE.md)**

The terminal already streamed Binance liquidations. CMC adds liquidation data across nine venues,
open interest across a wider venue sample, and the flags CMC applies to price and volume inputs.
The useful question is: **how much does the answer change when those flagged pairs are excluded?**

On 27 September 2026, a live check put Bitcoin's liquidation/open-interest ratio at about
**0.010% unfiltered and 0.024% filtered, 2.34× apart**. This is sensitivity to an assumption,
not proof that one open-interest figure is correct. The live page shows both and moves with the data.

## The terminal

[terminal.web3wagmi.com](https://terminal.web3wagmi.com) is one page for reading the crypto market
the way a desk does: every number sits next to its own reference (a percentile against its
history, a move in sigma, an implied against a realised), and every panel says what it covers and
what it misses. It is free, needs no account, and keeps every API key server-side.

The page is organised the way a morning goes:

- **Glance.** The brief, a note the terminal writes itself every six hours; what changed since the
  last read; a market snapshot; fees and revenue by protocol.
- **Market wide.** A stress index ranked against its own year, a live board of the tracked
  universe, and CMC volume quality.
- **Focused instrument.** Pick any symbol (`⌘K` or `?s=`) for its chart, order flow and options.
- **Derivatives.** Funding annualised by each contract's real settlement cadence, open-interest
  regimes read from contract counts, the live Binance liquidation tape, and the two CMC desks:
  forced selling across nine venues and liquidations relative to open interest.
- **On-chain.** Exchange flow from labelled Ethereum wallets, DEX pools, chains, protocols,
  stablecoins, yields, gas and token unlocks.
- **Analytics.** Returns, risk, correlation, breadth, sector rotation and a screener.

An assistant (`⌘K`, then a question) answers from the same routes the panels read and links each
answer back to its panel. `/status` shows which upstreams are answering; `/methodology` explains
every calculation.

CMC is the newest data source. It feeds three panels, the brief, and the assistant, and `/cmc`
gathers all of it in one place for judging.

## What CMC adds

- **Forced selling:** totals and side splits across nine venues, their concentration as an
  effective venue count, a collected history, and price/liquidation comparisons by coin.
- **Liquidations / open interest:** compare nine coins by liquidation value relative to sampled
  OI. Display both filtered and unfiltered denominators, plus funding direction and perp premium
  from the same pair responses.
- **Volume quality:** compare reported and counted spot and derivatives volume through a keyless
  endpoint. A discrepancy measures the vendor's inclusion choices; it does not prove fake trades.
- **Evidence:** `/cmc` displays the request, a shortened real response with its timestamp, the
  account credit ledger and the refresh budget. The evidence response is cached for up to an hour.
- **The brief:** the terminal's six-hourly note at the top of the home page reads all three CMC
  desks. Code joins them with funding, open-interest regimes and exchange flow into setups (a
  rally carried by short covering, a liquidation hotspot, the side being forced out flipping
  within the day), each with what it means for positioning and the reading that would prove it
  wrong. The model writes three sentences from those setups only. Four CMC tiles under the note
  show the readings it was given and link to their panels. The brief reads the
  routes' cached responses, so it spends no extra credits.
- **Assistant:** answers from the same routes and links to their panels.

## What the figures mean

CMC's `exclusions` and `outlier_detected` fields concern price/volume inputs. Applying them to OI
is our sensitivity assumption, **not CMC verification of open interest**.

Liquidations cover nine venues. OI covers the first 100 market pairs per coin across a wider set.
The liquidation/OI ratios therefore compare scale across different coverage sets; they do **not**
measure the fraction of a matching book wiped out. Coverage bars describe the fetched nine-coin
OI sample, not measured coverage of all market liquidations.

The API supplies rolling liquidation windows. A scheduled sampler targets every 30 minutes, with
actual gaps; deployed routes also collect a process-local tail. Percentiles describe this short,
irregularly sampled history, not a long-run probability. The page states the sample size.

## Run it

```bash
cp .env.example .env.local
# Set CMC_API_KEY; other integrations have their own optional credentials.
npm ci
npm run dev
```

```bash
npm run build
npm run typecheck
```

Next.js App Router, React, TypeScript and Tailwind. Keys are used server-side. `/status` checks
feeds; `/methodology` explains calculations. Failed upstreams return explicit unavailable states.
The CMC refresh budget is estimated at 13,680 credits per 30 days, below the Basic tier's 15,000;
actual spend is visible in the ledger and depends on runtime/cache behaviour.

## Originality and repository history

The terminal predates this event. Its CMC integration is new. This public mirror imports the
pre-existing terminal as one commit dated 10 September 2026, then replays subsequent working-repo
commits with their original dates. CMC work begins on 20 September UTC / 21 September UTC+8.
The base includes prior terminal and The Graph/AI work; those are not claimed as new CMC work.

The mirror is generated from a private working repository. App changes belong in that source;
README, JUDGE, ENDPOINTS, FEEDBACK, the environment template and public Dockerfile are mirror-owned.
See [JUDGE.md](JUDGE.md) for the inspection path, [ENDPOINTS.md](ENDPOINTS.md) for request/response
examples and [FEEDBACK.md](FEEDBACK.md) for API feedback.

MIT licensed. Market information, not personalised trading advice.
