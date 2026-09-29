# For a judge, in five minutes

**Track: Data and Visualisation.**
**[Open the complete live demo](https://terminal.web3wagmi.com/cmc).**

## The problem and the finding

The terminal's existing Binance tape sees one exchange. CMC adds a nine-venue liquidation view,
a wider open-interest sample and pair-level price/volume exclusions. The new work shows both the
broader event and how a data-filtering choice changes its interpretation.

At a live check on 27 September, Bitcoin's liquidation/OI ratio changed from about **0.010% to
0.024%** when flagged pairs were excluded. That 2.34× difference is a sensitivity finding, not a
claim that the filtered denominator is true. Read current figures from the page.

## Demo path

1. **Findings:** the share of sampled OI on flagged pairs and the filtered/unfiltered BTC ratio.
2. **Forced selling:** switch 1h/4h/24h; inspect the venue splits, effective venue count, history
   and squeeze/flush map. This distinguishes concentration within the feed without claiming a cause.
3. **Liquidations / open interest:** compare both ratios. The visible coverage note explains that
   nine-venue liquidations and wider sampled OI are different universes.
4. **Volume quality:** compare reported/counted spot volume against derivatives. This describes a
   gap in the vendor's aggregates, not proof of fictitious trades.
5. **Evidence:** inspect the real request and shortened response, its upstream timestamp, the
   credit ledger and budget. The evidence response is cached for up to one hour.

6. **The brief** (top of the home page, `/#brief`): the six-hourly note reads the three CMC
   desks. The setups under it are found in code by joining CMC forced orders and
   liquidations/OI with funding, OI regimes and exchange flow, each with its implication and the
   reading that would prove it wrong. The four CMC tiles are the readings the model was handed.

The assistant can answer “Where did liquidations happen today?” from these routes and link back
to the panels. The visualisation submission stands on the three panels without it.

## What the API contributes

Six endpoint paths: liquidation totals, liquidation splits by venue and coin, derivatives market
pairs, keyless global metrics, and key information. See [ENDPOINTS.md](ENDPOINTS.md).

Prices alone would add little to this terminal. The new capability is the combination of
cross-venue liquidation data with pair-level exclusions, OI and funding. Remove CMC and these
three panels lose their underlying data. A sampler builds the history the liquidation endpoints
lack. [FEEDBACK.md](FEEDBACK.md) records practical API limitations and proposed improvements.

## Scope and limitations

- Pair flags concern price/volume; filtering their OI is our inference. Neither inclusion nor
  exclusion verifies OI. Both denominators are shown.
- OI reads the first 100 pairs per coin across nine sampled coins. Liquidations cover nine venues.
  The ratios are comparisons, not a percentage of a matching book closed. OI coverage shares
  cannot establish how much of total market liquidations is observed.
- A 30-minute target sampling schedule has actual gaps. The live tail is lost on process restart;
  committed samples remain. Thirty observations unlock a descriptive percentile, not statistical
  confidence or a long-run probability.
- Funding uses sign only because the API omits settlement periods. OI-weighted positive funding
  is not the percentage of traders who are long.
- Planned spend is 13,680 credits per 30 days against 15,000 Basic credits. Runtime/cache behaviour
  can change actual spend; the account ledger makes that visible. See `/status` during judging.

## New work versus existing work

The pre-existing terminal, its Binance tape, general market panels, The Graph integration and
assistant are disclosed as prior work. The base import is dated 10 September 2026 and contains
152 working-repository commits of that earlier work, including work for another event.
CMC integration begins on 20 September UTC / 21 September UTC+8. Subsequent source commits retain
their original author and committer dates. Mirror-owned documents land at publication time.

```bash
git log --format='%ad  %s' --date=iso
git diff --stat $(git rev-list --max-parents=0 HEAD)
```

New CMC work includes `lib/cmc.ts`, the forced/leverage/volume API routes and panels, `/cmc`,
`lib/liqSeries.ts`, `scripts/cmc-sample.mjs`, the sampler workflow, collected samples, findings,
coverage comparisons, CMC tools for the existing assistant, and the CMC evidence, setups and
tiles in the brief (`lib/brief.ts`, `components/MorningBrief.tsx`). Shared navigation, methodology
and status pages wire it into the terminal.

The public workflow shows the sampler, with its schedule disabled: it runs in the working
repository and samples enter this mirror through sync. Replay rebuilds hashes; compare contents
and original dates, not hashes quoted elsewhere.

## Run and inspect

Follow [README.md](README.md). The CMC panels need a server-side `CMC_API_KEY`; the environment
template lists optional keys for the terminal's other feeds. Build with `npm run build` and check
types with `npm run typecheck`. MIT licence in [LICENSE](LICENSE).
