"use client";

import { AsOf, BarCell, Loading, Panel, Section, TableWrap, Th, Unavailable } from "@/components/ui";
import { pctPlain, usdCompact , NA} from "@/lib/format";
import { useApi } from "@/lib/useApi";
import type { VolumePayload } from "@/app/api/volume/route";

// What the venues claim they traded, against what CoinMarketCap will count.
//
// Every exchange reports its own turnover and every one of them has a reason to
// overstate it. CoinMarketCap is the only free source that publishes both the
// adjusted figure and the reported figure side by side, which makes the ratio
// between them the only free wash-trading gauge there is.
//
// The panel leads on the spread between slices rather than on any one level.
// "Wash trading is high" is not actionable and not checkable. "Spot is inflated
// six times over while derivatives are inflated by four percent, measured the
// same way by the same vendor on the same day" says where it sits.

/** Above this multiple a slice reads as inflated rather than merely adjusted. */
const HIGH = 3;

/** The free tier allowance, for the footnote. Matches BUDGET.basicMonthlyCredits. */
const BUDGET_LABEL = "15,000";

export function VolumeQuality() {
  const { data, loading, failed } = useApi<VolumePayload>("/api/volume", 900);

  const rows = data?.rows ?? [];
  const spot = rows.find((r) => r.key === "total") ?? null;
  const deriv = rows.find((r) => r.key === "deriv") ?? null;
  const maxInflation = Math.max(0, ...rows.map((r) => r.inflation ?? 0));

  return (
    <Section
      title="Volume quality"
      id="volume"
      hint="What venues reported trading in the last 24 hours, against what CoinMarketCap counts after its own adjustments. The gap is volume it will not vouch for. No other free source publishes both numbers."
    >
      <Panel
        title="Reported against counted, 24h"
        right={<AsOf iso={data?.asOf} staleMs={2 * 3600 * 1000} />}
      >
        {loading && <Loading rows={5} />}

        {!loading && (failed || !data?.ok) && (
          <Unavailable what="Volume quality" reason={data?.failure} />
        )}

        {!loading && data?.ok && spot && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="font-mono text-2xl font-bold tabular-nums text-[var(--text)]">
                  {spot.inflation ? `${spot.inflation.toFixed(2)}x` : NA}
                </div>
                <div className="mt-1 text-[11px] text-[var(--text3)]">
                  spot volume reported against counted
                </div>
                {spot.discarded != null && (
                  <div className="mt-2 font-mono text-[11px] tabular-nums text-[var(--text2)]">
                    {pctPlain(100 * spot.discarded)} of {usdCompact(spot.reported)} discarded
                  </div>
                )}
              </div>

              <div>
                <div
                  className="font-mono text-2xl font-bold tabular-nums"
                  style={{ color: deriv?.inflation && deriv.inflation < HIGH ? "var(--pos)" : "var(--text)" }}
                >
                  {deriv?.inflation ? `${deriv.inflation.toFixed(2)}x` : NA}
                </div>
                <div className="mt-1 text-[11px] text-[var(--text3)]">
                  the same on derivatives volume
                </div>
                {data.spotVsDerivatives != null && (
                  <div className="mt-2 font-mono text-[11px] tabular-nums text-[var(--text2)]">
                    a {data.spotVsDerivatives.toFixed(2)}x gap between the two
                  </div>
                )}
              </div>
            </div>

            {spot.inflation != null && deriv?.inflation != null && (
              <p className="mt-4 border-t border-[var(--border)] pt-3 text-[11px] leading-relaxed text-[var(--text2)]">
                {deriv.inflation < HIGH && spot.inflation >= HIGH ? (
                  <>
                    The inflation sits on spot order books. Derivatives volume comes in at{" "}
                    <span className="font-mono tabular-nums">{deriv.inflation.toFixed(2)}x</span>,
                    close to everything reported being counted, while spot runs at{" "}
                    <span className="font-mono tabular-nums">{spot.inflation.toFixed(2)}x</span>.
                    Perpetual turnover is hard to fake against an open interest figure and a funding
                    rate. A spot book has neither.
                  </>
                ) : (
                  <>
                    Spot runs at{" "}
                    <span className="font-mono tabular-nums">{spot.inflation.toFixed(2)}x</span> and
                    derivatives at{" "}
                    <span className="font-mono tabular-nums">{deriv.inflation.toFixed(2)}x</span>,
                    so the two slices are being adjusted by similar amounts today.
                  </>
                )}
              </p>
            )}

            <div className="mt-5">
              <TableWrap maxHeight={320}>
                <thead>
                  <tr>
                    <Th label="Slice" />
                    <Th
                      label="Reported"
                      num
                      hint="The sum of what the venues said they traded in the last 24 hours."
                    />
                    <Th
                      label="Counted"
                      num
                      hint="What CoinMarketCap includes after its own adjustments. This is the figure its site and most of the market quote."
                    />
                    <Th label="Inflation" num hint="Reported divided by counted. 1.00x means every reported dollar was counted." />
                    <Th label="" className="w-24" />
                    <Th label="Discarded" num />
                    <Th
                      label="Percentile"
                      num
                      hint="Where today's inflation sits in the series this desk has collected. Blank until there are thirty samples to rank against."
                    />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key}>
                      <td className="ident break-words">{r.label}</td>
                      <td className="num text-[var(--text3)]">{usdCompact(r.reported)}</td>
                      <td className="num">{usdCompact(r.counted)}</td>
                      <td
                        className="num font-semibold"
                        style={{ color: (r.inflation ?? 0) >= HIGH ? "var(--neg)" : "var(--pos)" }}
                      >
                        {r.inflation ? `${r.inflation.toFixed(2)}x` : NA}
                      </td>
                      <td className="num">
                        <BarCell
                          value={r.inflation ?? 0}
                          max={maxInflation}
                          color={(r.inflation ?? 0) >= HIGH ? "var(--neg)" : "var(--pos)"}
                        />
                      </td>
                      <td className="num text-[var(--text3)]">
                        {r.discarded != null ? pctPlain(100 * r.discarded) : NA}
                      </td>
                      <td className="num text-[var(--text3)]">
                        {r.percentile != null ? `${r.percentile}th` : NA}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>

            <p className="mt-2 text-[11px] leading-relaxed text-[var(--text3)]">
              {data.sample.n >= 30 ? (
                <>
                  Percentiles rank against {data.sample.n} samples collected since{" "}
                  {data.sample.from?.slice(0, 10)}.
                </>
              ) : (
                <>
                  The collected series holds {data.sample.n}{" "}
                  {data.sample.n === 1 ? "sample" : "samples"}, too few to rank today against. It
                  grows forward every thirty minutes.
                </>
              )}{" "}
              These figures come from CoinMarketCap&apos;s keyless endpoint, so this panel spends
              nothing against the plan&apos;s {BUDGET_LABEL} credits a month and competes with no
              other desk for them.
            </p>
          </>
        )}
      </Panel>
    </Section>
  );
}
