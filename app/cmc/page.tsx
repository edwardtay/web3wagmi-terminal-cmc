import type { Metadata } from "next";
import Link from "next/link";
import { Panel, Section } from "@/components/ui";
import { PageChrome } from "@/components/PageChrome";
import { BUDGET, cmcRaw, cmcReady, keyInfo, type CallRecord } from "@/lib/cmc";
import { usdCompact } from "@/lib/format";

// What CoinMarketCap runs on this terminal, and the evidence that it is really
// being called.
//
// The submission this page belongs to asks for "visible evidence of a real API
// call: code and response". A README can assert that. A page that makes the
// call while you are looking at it, prints the response verbatim, and shows the
// account's own credit ledger beside it, cannot be asserting anything: the
// numbers either match a reader's own dashboard or they do not.
//
// It wears the terminal's own chrome for the same reason /thegraph does. A page
// in a different visual language reads as a microsite about the product, and
// the claim is that these desks are part of the product.

export const metadata: Metadata = {
  title: "CoinMarketCap on this terminal | Web3WAGMI Terminal",
  description:
    "The cross-venue liquidation desks, what they cost in credits, and a live request and response. Built for the Build with CMC API Hackathon.",
  alternates: { canonical: "https://terminal.web3wagmi.com/cmc" },
};

// One live call for the verbatim evidence, at 1 credit.
//
// BUDGET.monthly(3600, 1) is 720 credits a month. With the sampler at 2,880,
// /api/forced at 6,480 and /api/leverage at 3,600 that is 13,680 of the free
// tier's 15,000, and the rest is headroom for /status probes.
export const revalidate = 3600;

/** Every endpoint this terminal calls, with the cost measured rather than assumed. */
const ENDPOINTS: {
  path: string;
  credits: number;
  keyless?: boolean;
  window: string;
  monthly: number;
  used: string;
}[] = [
  { path: "/v5/derivatives/liquidations/quotes/latest", credits: 1, window: "20 min", monthly: 2160, used: "Forced selling, the headline" },
  { path: "/v5/derivatives/liquidations/exchange/list/latest", credits: 1, window: "20 min + 30 min", monthly: 3600, used: "Forced selling, the venue split. Also the sampler" },
  { path: "/v5/derivatives/liquidations/cryptocurrency/list/latest", credits: 1, window: "20 min + 2 h + 30 min", monthly: 3960, used: "Forced selling and Leverage cleared. Also the sampler" },
  { path: "/v5/cryptocurrency/derivatives/market-pairs/list/latest", credits: 1, window: "2 h, nine coins", monthly: 3240, used: "Leverage cleared, the open interest denominator" },
  { path: "/public-api/v1/global-metrics/quotes/latest", credits: 0, keyless: true, window: "30 min", monthly: 0, used: "Volume quality. Keyless, so it costs nothing" },
  { path: "/v1/key/info", credits: 0, window: "1 h", monthly: 0, used: "This page. Free" },
];

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-[var(--border)] py-2 last:border-0 sm:grid-cols-[180px_1fr] sm:gap-4">
      <div className="font-mono text-[11px] font-semibold text-[var(--text2)]">{term}</div>
      <div className="min-w-0 text-[12px] leading-relaxed text-[var(--text2)]">{children}</div>
    </div>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="thin-scroll overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--bg2)] p-3 font-mono text-[11px] leading-relaxed text-[var(--text2)]">
      {children}
    </pre>
  );
}

/** Trim a payload to one array element so the page prints a shape, not a wall. */
function sample(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) {
    return value.length > 1 ? [sample(value[0], depth + 1), `... ${value.length} items`] : value.map((v) => sample(v, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, sample(v, depth + 1)]));
  }
  return value;
}

export default async function CmcPage() {
  const collect: CallRecord[] = [];

  // The demonstration call and the ledger, made while the page renders.
  const [{ url, envelope }, key] = await Promise.all([
    cmcRaw<{ exchanges: unknown[]; total_size: number }>(
      "/v5/derivatives/liquidations/exchange/list/latest",
      {},
      { revalidate, collect }
    ),
    keyInfo({ revalidate, collect }),
  ]);

  const routeTotal = ENDPOINTS.reduce((s, e) => s + e.monthly, 0);

  return (
    <PageChrome
      title="CoinMarketCap"
      crumb="cmc"
      wide
      intro={
        <>
          This terminal streamed Binance force orders for months, which is one venue&apos;s share of
          an event that happens across the whole market. CoinMarketCap publishes the cross-venue
          figure and nobody else gives it away. This page is the evidence that it is really being
          called, with the cost measured rather than asserted.
        </>
      }
    >
      <Section title="The desks it runs" id="desks">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <Panel title="Forced selling">
            <div className="space-y-2 text-[12px] leading-relaxed text-[var(--text2)]">
              <p>
                Liquidations across all nine derivatives venues CoinMarketCap reports, split by
                venue and by coin, with how far the selling spread measured as an effective venue
                count.
              </p>
              <p>
                <Link href="/#forced" className="underline hover:text-[var(--text)]">
                  the panel
                </Link>
              </p>
            </div>
          </Panel>
          <Panel title="Leverage cleared">
            <div className="space-y-2 text-[12px] leading-relaxed text-[var(--text2)]">
              <p>
                The same liquidations divided by the open interest behind them, which ranks by how
                much of a book went rather than by dollar size. The denominator counts only the
                market pairs CoinMarketCap vouches for.
              </p>
              <p>
                <Link href="/#leverage" className="underline hover:text-[var(--text)]">
                  the panel
                </Link>
              </p>
            </div>
          </Panel>
          <Panel title="Volume quality">
            <div className="space-y-2 text-[12px] leading-relaxed text-[var(--text2)]">
              <p>
                What venues claimed they traded against what CoinMarketCap counts. It is the only
                free source publishing both, and the gap between the spot and derivatives slices is
                the reading.
              </p>
              <p>
                <Link href="/#volume" className="underline hover:text-[var(--text)]">
                  the panel
                </Link>
              </p>
            </div>
          </Panel>
        </div>
      </Section>

      <div className="mt-4">
        <Section title="A real call, made while this page rendered" id="evidence">
          <Panel title="Request">
            <div className="space-y-3">
              <p className="text-[12px] leading-relaxed text-[var(--text2)]">
                The key travels on the <span className="font-mono">X-CMC_PRO_API_KEY</span> header
                and never in a URL, which is why this one is safe to print.
              </p>
              <Code>{`curl -H "X-CMC_PRO_API_KEY: $CMC_API_KEY" \\\n  '${url}'`}</Code>
            </div>
          </Panel>

          <div className="mt-3">
            <Panel title="Response">
              {envelope ? (
                <div className="space-y-3">
                  <Code>{JSON.stringify({ status: envelope.status, data: sample(envelope.data) }, null, 2)}</Code>
                  <p className="text-[12px] leading-relaxed text-[var(--text2)]">
                    Arrays are trimmed to one element so this prints a shape rather than a wall. The{" "}
                    <span className="font-mono">status</span> block is verbatim, and{" "}
                    <span className="font-mono">credit_count</span> in it is what the account was
                    billed for this request. Check it against the ledger below.
                  </p>
                </div>
              ) : (
                <p className="text-[12px] leading-relaxed text-[var(--text2)]">
                  {cmcReady()
                    ? "CoinMarketCap did not answer this request. The panels degrade to an explained empty state rather than a blank card when that happens."
                    : "No key is configured on this deployment, so there is nothing to show here."}
                </p>
              )}
            </Panel>
          </div>
        </Section>
      </div>

      <div className="mt-4">
        <Section title="The account's own ledger" id="ledger">
          <Panel title="Live from /v1/key/info, which costs nothing">
            {key ? (
              <div>
                <Row term="Plan">
                  {key.plan.credit_limit_monthly.toLocaleString("en-US")} credits a month,{" "}
                  {key.plan.rate_limit_minute} requests a minute. This is the free Basic tier.
                </Row>
                <Row term="Used this month">
                  {key.usage.current_month.credits_used.toLocaleString("en-US")} credits,{" "}
                  {key.usage.current_month.credits_left.toLocaleString("en-US")} left.
                </Row>
                <Row term="Today">{key.usage.current_day.credits_used.toLocaleString("en-US")} credits.</Row>
                <Row term="This minute">
                  {key.usage.current_minute.requests_made} requests made,{" "}
                  {key.usage.current_minute.requests_left} left.
                </Row>
                <Row term="Resets">{key.plan.credit_limit_monthly_reset}</Row>
              </div>
            ) : (
              <p className="text-[12px] text-[var(--text2)]">The ledger could not be read.</p>
            )}
          </Panel>
        </Section>
      </div>

      <div className="mt-4">
        <Section title="What it costs" id="budget">
          <Panel title="Every endpoint, with the cost measured from the response envelope">
            <div className="thin-scroll overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th className="ident">Endpoint</th>
                    <th className="num">Credits</th>
                    <th className="ident">Refresh</th>
                    <th className="num">A month</th>
                    <th className="ident">Used by</th>
                  </tr>
                </thead>
                <tbody>
                  {ENDPOINTS.map((e) => (
                    <tr key={e.path}>
                      <td className="ident break-all font-mono text-[11px]">{e.path}</td>
                      <td className="num">{e.credits}</td>
                      <td className="ident">{e.window}</td>
                      <td className="num">{e.monthly ? e.monthly.toLocaleString("en-US") : "0"}</td>
                      <td className="ident break-words">{e.used}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="ident font-semibold">Total</td>
                    <td className="num" />
                    <td className="ident" />
                    <td className="num font-semibold">{routeTotal.toLocaleString("en-US")}</td>
                    <td className="ident">of {BUDGET.basicMonthlyCredits.toLocaleString("en-US")} allowed</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="mt-4 space-y-2 text-[12px] leading-relaxed text-[var(--text2)]">
              <p>
                Sized for the free Basic tier deliberately. The hackathon grants Startup access for
                the event window, and that access ends when submissions close on 30 September while
                judging runs to 16 October. A desk tuned to the event tier goes dark in the
                fortnight it is scored in.
              </p>
              <p>
                Traffic does not enter this arithmetic. A route with a{" "}
                <span className="font-mono">revalidate</span> window costs the same for one visitor
                as for a thousand, so the refresh window is the only lever.
              </p>
              <p>
                Two of the rows cost nothing.{" "}
                <span className="font-mono">/v1/key/info</span> is free, and global metrics comes
                from the keyless mirror at <span className="font-mono">/public-api</span>, which
                serves without a credential. That mirror reports{" "}
                <span className="font-mono">credit_count: 1</span> and bills zero: six calls through
                it moved this account&apos;s ledger by nothing. The figure above is what was
                actually billed.
              </p>
            </div>
          </Panel>
        </Section>
      </div>

      <div className="mt-4">
        <Section title="What is new, and what was already here" id="continuity">
          <Panel title="The line, drawn plainly">
            <div className="space-y-3 text-[12px] leading-relaxed text-[var(--text2)]">
              <p>
                The terminal predates this hackathon by months and is deployed at{" "}
                <span className="font-mono">terminal.web3wagmi.com</span>. Nothing that predates it
                touches CoinMarketCap, and no CoinMarketCap code predates it.
              </p>
              <p>
                New for the hackathon: <span className="font-mono">lib/cmc.ts</span>,{" "}
                <span className="font-mono">lib/liqSeries.ts</span>, the{" "}
                <span className="font-mono">/api/forced</span>,{" "}
                <span className="font-mono">/api/leverage</span> and{" "}
                <span className="font-mono">/api/volume</span> routes, their three panels, the
                sampler that collects the history this API does not publish, and this page.
              </p>
              <p>
                The liquidation feed serves rolling 1h, 4h and 24h windows and nothing older, so
                every percentile on those panels ranks against a series this desk collects for
                itself every thirty minutes. It cannot be backfilled, and each panel states its
                sample size rather than printing a confident number over a short one.
              </p>
              <p>
                Nine venues is the whole universe that feed covers, so a venue share is a share of
                what CoinMarketCap can see. CoinMarketCap disclaims the accuracy of the third-party
                venue data it relays. Both limits are repeated on{" "}
                <Link href="/methodology" className="underline hover:text-[var(--text)]">
                  the methodology page
                </Link>
                .
              </p>
            </div>
          </Panel>
        </Section>
      </div>

      <div className="mt-4">
        <Section title="Where the API got in the way" id="feedback">
          <Panel title="The short version">
            <div className="space-y-3 text-[12px] leading-relaxed text-[var(--text2)]">
              <p>
                <strong className="text-[var(--text)]">Open interest cannot be swept.</strong> It
                lives only on market pairs and needs one coin per call, so pricing nine coins costs
                nine credits. An <span className="font-mono">open_interest</span> field on the coin
                liquidation endpoint, which already returns 100 coins for one credit, would remove
                the single constraint that shaped this project.
              </p>
              <p>
                <strong className="text-[var(--text)]">
                  The outlier flags are the best thing here and are undocumented as a feature.
                </strong>{" "}
                Pairs carrying <span className="font-mono">outlier_detected</span> or an exclusion
                hold about half of all reported open interest across the majors, and 61% of
                Bitcoin&apos;s. Filtering on them moves Bitcoin&apos;s ratio by a factor of 2.6.
                Anyone summing the field without checking them is wrong by roughly that much.
              </p>
              <p>
                <strong className="text-[var(--text)]">
                  <span className="font-mono">error_code</span> changes type between versions.
                </strong>{" "}
                A string on v3 and v5, a number on v1, so a client comparing it strictly breaks on
                whichever half it was not written against.
              </p>
              <p>
                There are nine more, including the keyless mirror&apos;s credit claim, in{" "}
                <span className="font-mono">FEEDBACK.md</span> in the public repository.
              </p>
            </div>
          </Panel>
        </Section>
      </div>
    </PageChrome>
  );
}
