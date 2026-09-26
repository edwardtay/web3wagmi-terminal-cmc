import type { Metadata } from "next";
import { PageChrome } from "@/components/PageChrome";

export const metadata: Metadata = {
  title: "Methodology | Web3WAGMI Terminal",
  description:
    "Where every number on the terminal comes from, how each derived metric is computed, and what the limits are.",
  alternates: { canonical: "https://terminal.web3wagmi.com/methodology" },
};

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-2 font-display text-base font-bold tracking-tight text-[var(--text)]">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-[var(--text2)]">{children}</div>
    </section>
  );
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <p>
      <span className="font-mono text-[12px] font-bold text-[var(--text)]">{term}</span>{" "}
      <span className="break-words">{children}</span>
    </p>
  );
}

export default function MethodologyPage() {
  return (
    <PageChrome
      title="Methodology"
      crumb="methodology"
      intro={
        <>
          Nothing here is hand-entered, and nothing is modelled beyond what is described on this
          page. Where a metric is our own construction, the recipe is written out so you can
          disagree with it. Every source is public; one of them, The Graph, needs a key.
        </>
      }
    >

      <div className="mt-8">
        <Block title="Sources">
          <Row term="Binance">
            Spot and USDT-margined futures public REST and WebSocket. Prices, candles, order book,
            trades, funding, open interest, account positioning and the all-market liquidation
            stream.
          </Row>
          <Row term="Hyperliquid">
            The public <span className="font-mono">info</span> endpoint, for on-chain perpetual
            funding. Used against Binance funding to show where the two venues disagree.
          </Row>
          <Row term="Deribit">
            Public v2 API. Option book summaries, the DVOL implied volatility index, and index
            prices. Deribit is where most crypto options volume clears, so it is a reasonable proxy
            for the market.
          </Row>
          <Row term="DefiLlama">
            Chain and protocol TVL, DEX volume, protocol fees and revenue, yield pools, token
            emissions, and the stablecoin dataset.
          </Row>
          <Row term="GeckoTerminal">
            Trending and newly created DEX pools across every network it indexes, with pool level
            price, volume, liquidity and trade counts.
          </Row>
          <Row term="Archive JSON-RPC nodes">
            Historical <span className="font-mono">eth_call</span> and{" "}
            <span className="font-mono">eth_getBalance</span> reads for the exchange netflow panel.
          </Row>
          <Row term="CoinMarketCap">
            The Pro API, which needs a key. Used for one thing the other sources here cannot give:
            liquidation value aggregated across the nine derivatives venues it reports, broken out
            per venue and per coin. Binance publishes force orders for Binance and Hyperliquid
            publishes Hyperliquid, so the cross-venue total has no free substitute. CoinMarketCap
            disclaims the accuracy of the venue data it relays.
          </Row>
          <Row term="CoinGecko">Total market capitalisation, volume, and Bitcoin and Ethereum dominance.</Row>
          <Row term="alternative.me">The Fear and Greed index, taken as published.</Row>
          <Row term="mempool.space">Bitcoin fee tiers, mempool backlog, hashrate and block height.</Row>
          <Row term="Public JSON-RPC nodes">
            Base fee and priority fee percentiles via <span className="font-mono">eth_feeHistory</span> on
            Ethereum, Base, Arbitrum, Optimism and BNB Chain.
          </Row>
        </Block>

        <Block title="Derived metrics">
          <Row term="Annualised funding">
            The current funding rate scaled by the settlement cadence: a rate that settles every
            eight hours annualises as rate x 3 x 365. Hyperliquid settles hourly, so its rate
            annualises as rate x 24 x 365. Compare the annualised figures, never the raw ones.
          </Row>
          <Row term="Exchange netflow">
            The balance of publicly labelled exchange wallets on Ethereum now, against the same
            wallets at the block that started the window. Positive means coins arrived. Cold wallets
            are included on purpose, so a hot to cold shuffle nets out instead of reading as an
            outflow. Coverage is USDT, USDC, native ETH and WBTC in wallets that hold a real balance;
            Kraken and OKX are absent because their commonly cited Ethereum labels are drained today.
            Deposits to an unlabelled wallet, and every other chain, are invisible, so read the
            direction rather than the absolute size.
          </Row>
          <Row term="Venue concentration">
            The inverse Herfindahl index of liquidation value across the nine derivatives venues
            CoinMarketCap reports, shown as an effective venue count. Near 1 means one exchange
            carried nearly all of it; near 9 means the selling was spread evenly. The 0 to 100 score
            beside it rescales the same index so 0 is perfectly even and 100 is all on one venue. It
            is ranked against a series this desk collects for itself every thirty minutes, because
            the feed publishes only rolling windows, and the reading says how many samples it is
            ranking against. Under thirty samples it declines to rank at all.
          </Row>
          <Row term="Leverage cleared">
            A coin&apos;s 24 hour liquidation value divided by the open interest standing behind it.
            This ranks by how much of a book went rather than by dollar size, so a mid-cap losing
            half a percent of its open interest sits above a major losing a tenth. The denominator
            sums only the market pairs CoinMarketCap vouches for: it marks pairs with
            <span className="font-mono"> outlier_detected</span> or an exclusion, and those carried
            about half the reported open interest across the majors when this was built. The
            unfiltered ratio is published beside it, and for Bitcoin the two differ by roughly two
            and a half times. The denominator covers the top 100 market pairs by 24 hour volume,
            which is one page of the feed: Bitcoin has 195 and the unread tail held 4.1% more open
            interest when this was measured. The table states the pairs read against the pairs the
            coin has, so the shortfall is visible rather than assumed away.
          </Row>
          <Row term="Squeeze or flush">
            Each coin&apos;s liquidations set against its Binance spot price over the same rolling
            window. A short squeeze is shorts carrying two thirds or more of the value while the
            price rose; a long flush is the mirror. When one side carried two thirds but the price
            moved less than 0.2% in an hour, 0.4% in four or 1% in a day, the forced orders were
            absorbed. The band scales with the square root of the window, the way a typical move
            does. Neither side at two thirds reads two-sided, and a window under $250K is left
            blank because a few positions decide its split.
          </Row>
          <Row term="Liquidation alerts">
            The dislocation queue fires when a 1h or 4h liquidation total reaches the 90th
            percentile of the series this desk collects, and when one venue&apos;s share reaches the
            95th percentile of concentration in a window at least as heavy as the median. A
            concentrated quiet hour is a handful of positions on one book, so size is required too.
          </Row>
          <Row term="Longs paying">
            The share of that same vouched-for perpetual open interest sitting on venues where
            funding is positive, so longs pay shorts to hold. It comes from the call that supplies
            the open interest, so it costs nothing extra, and it spans every venue CoinMarketCap
            lists for the coin, around forty to fifty, against the two the funding desk reads. Only
            the sign is used. The feed reports each venue&apos;s rate per settlement period and
            omits the period, and Hyperliquid settles hourly where most venues settle every eight
            hours, so the rates cannot be annualised or averaged from this feed. A zero rate counts
            as flat and sits on neither side. 50% is an even split.
          </Row>
          <Row term="Pool turnover and FDV to liquidity">
            Turnover is 24 hour pool volume divided by pool liquidity. FDV to liquidity is fully
            diluted value divided by pool liquidity. Both are arithmetic on the pool row and neither
            says anything about the contract.
          </Row>
          <Row term="Open interest regime">
            Read from the sign pair of the 24h price change and the 24h open interest change. Price
            up with OI up is new longs, price down with OI up is new shorts, price up with OI down
            is short covering, price down with OI down is long liquidation.
          </Row>
          <Row term="Realised volatility">
            Standard deviation of daily log returns, annualised by the square root of 365. Crypto
            trades every day, so the 252 trading-day convention from equities does not apply.
          </Row>
          <Row term="Sharpe and Sortino">
            Annualised mean return divided by annualised volatility, risk-free rate set to zero.
            Sortino uses downside deviation only. Both are computed over daily returns.
          </Row>
          <Row term="Correlation">
            Pearson correlation of daily log returns over the selected window, computed pairwise on
            the overlapping history.
          </Row>
          <Row term="Skew">
            An approximation. The public book summary carries no greeks, so the panel uses the
            call implied volatility minus put implied volatility at the strikes roughly 0.674
            standard deviations either side of the forward, so negative means puts trade above
            calls. It tracks the shape of real 25-delta risk reversal without being identical to it.
          </Row>
          <Row term="Max pain">
            The strike that minimises the total in-the-money value across all open interest at an
            expiry. It describes where the largest notional expires worthless, and it is not a
            forecast.
          </Row>
          <Row term="Alt-season index">
            Our own 0 to 100 reading over the top 100 USDT spot pairs: 45 percent the share beating
            Bitcoin over 30 days, 25 percent the share beating Bitcoin over 7 days, 20 percent the
            share above its 200 day moving average, 10 percent the share up over 7 days. Above 75
            reads as alt season, below 25 as a Bitcoin-only tape.
          </Row>
          <Row term="Crypto Stress Index">
            Our own composite. Six inputs, each percentile-ranked against its own trailing history
            rather than an arbitrary scale: realised volatility, Deribit DVOL, absolute median
            funding, supply-weighted stablecoin peg deviation, average pairwise correlation, and
            Bitcoin drawdown from its one year high. Weights and every component score are shown in
            the panel, and any component whose upstream is down is dropped with the rest re-weighted
            and marked.
          </Row>
        </Block>

        <Block title="Limits worth knowing">
          <p>
            TVL is denominated in dollars, so a chain&apos;s TVL can move purely because its native
            token moved. Read a TVL change alongside the token&apos;s price change.
          </p>
          <p>
            The live force-order tape covers the current browser session and Binance USDT-margined
            futures alone. It starts empty on every page load and holds only what has printed since,
            so it understates the market on two counts. The cross-venue panel below it answers the
            second one: on 20 September 2026 Binance carried 54% of the day&apos;s liquidation value
            across the nine venues CoinMarketCap reports.
          </p>
          <p>
            Nine venues is the whole universe that feed covers, so a venue share on that panel is a
            share of what CoinMarketCap can see rather than of every derivatives venue that exists.
          </p>
          <p>
            CoinMarketCap publishes no historical liquidation endpoint, only rolling 1h, 4h and 24h
            windows. The concentration percentile therefore ranks against a series this desk has
            collected for itself since 20 September 2026, and the panel states the sample size
            beside the reading. A container holds whatever series was in the image it was built
            from, so a long gap between deploys shows as an older sample window.
          </p>
          <p>
            Yield figures are as published by each protocol through DefiLlama. A yield that is
            mostly token emissions is flagged, because it depends on the price of the reward token
            rather than on protocol earnings.
          </p>
          <p>
            Price alerts run in your browser while the tab is open. Nothing is stored on a server
            and nothing fires once the tab is closed.
          </p>
          <p>
            Everything here is market information. None of it is advice, and no panel accounts for
            your position, your costs or your tax.
          </p>
        </Block>
      </div>

      <p className="mt-6 text-xs text-[var(--text3)]">
        <a href="/" className="hover:text-[var(--text)]">
          Back to the terminal
        </a>
        {" · "}
        <a href="/status" className="hover:text-[var(--text)]">
          Data status
        </a>
      </p>
    </PageChrome>
  );
}
