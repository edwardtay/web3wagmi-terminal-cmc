import { jsonResponse } from "@/lib/http";
import { BUDGET, FAILURE_TEXT, globalMetrics, type CallRecord } from "@/lib/cmc";
import { percentile, volSeries, type VolSlice } from "@/lib/liqSeries";

// How much of the world's printed volume CoinMarketCap refuses to count.
//
// Every venue reports its own turnover and has every reason to overstate it.
// CoinMarketCap publishes both numbers: `total_volume_24h` is what it counts
// after its own adjustments, `total_volume_24h_reported` is what the venues
// claimed. Measured 2026-09-20: $70.5bn against $435.7bn, so 83.8% of printed
// spot volume was discarded.
//
// No other free source publishes an adjusted figure beside a reported one.
// CoinGecko, DefiLlama and the exchange APIs each give one number and no way to
// know what it excludes.
//
// What the panel reads off is the spread between the slices. Derivatives came
// in at 1.04x while spot was 6.18x, which locates the inflation on spot order
// books. A single "wash trading is high" number says nothing useful; the gap
// between two slices of the same market, measured the same way by the same
// vendor on the same day, says where it sits.

// Zero credits.
//
// This reads the keyless mirror at `/public-api`, which serves global metrics
// without a credential and without spending against the 15,000 a month the free
// Basic tier allows. That is the whole reason this panel exists at this refresh
// rate: it competes with nothing.
//
// 1800 because the underlying figure is a 24h rolling window that CoinMarketCap
// itself updates every few minutes. Reading it faster would show noise on a
// number whose denominator is a day.
export const revalidate = 1800;
const CACHE = 1800;

const SLICES = [
  { key: "total", label: "All spot", counted: "total_volume_24h", reported: "total_volume_24h_reported" },
  { key: "alt", label: "Altcoins", counted: "altcoin_volume_24h", reported: "altcoin_volume_24h_reported" },
  { key: "stable", label: "Stablecoins", counted: "stablecoin_volume_24h", reported: "stablecoin_volume_24h_reported" },
  { key: "defi", label: "DeFi", counted: "defi_volume_24h", reported: "defi_volume_24h_reported" },
  { key: "deriv", label: "Derivatives", counted: "derivatives_volume_24h", reported: "derivatives_volume_24h_reported" },
] as const;

export interface VolumeRow {
  key: VolSlice;
  label: string;
  /** What CoinMarketCap counts, in USD. */
  counted: number;
  /** What the venues claimed, in USD. */
  reported: number;
  /** reported / counted. 1.0 means every reported dollar was counted. */
  inflation: number | null;
  /** Share of reported volume that was discarded, 0 to 1. */
  discarded: number | null;
  /** Where this inflation sits in the collected series, or null when it is too short. */
  percentile: number | null;
}

export interface VolumePayload {
  ok: boolean;
  asOf: string | null;
  failure: string | null;
  rows: VolumeRow[];
  /**
   * Spot inflation minus derivatives inflation, which is the reading. A single
   * slice's level is a curiosity; the gap between two slices measured the same
   * way on the same day says where the inflation actually sits.
   */
  spotVsDerivatives: number | null;
  sample: { n: number; from: string | null; to: string | null };
  credits: number;
  budget: { monthly: number; routeAllowance: number };
}

function empty(failure: string | null): VolumePayload {
  return {
    ok: false,
    asOf: null,
    failure,
    rows: [],
    spotVsDerivatives: null,
    sample: { n: 0, from: null, to: null },
    credits: 0,
    // Zero calls against the quota, stated rather than left to be assumed.
    budget: { monthly: BUDGET.monthly(revalidate, 0), routeAllowance: BUDGET.routeAllowance() },
  };
}

export async function GET() {
  const calls: CallRecord[] = [];
  const [gm, series] = await Promise.all([
    globalMetrics({ revalidate, collect: calls }),
    volSeries(),
  ]);

  const q = gm?.quote?.USD;
  if (!q) {
    const failure = calls.find((c) => c.failure)?.failure ?? "upstream";
    return jsonResponse(empty(FAILURE_TEXT[failure]), 60);
  }

  const rows: VolumeRow[] = SLICES.map((s) => {
    const counted = Number(q[s.counted]) || 0;
    const reported = Number(q[s.reported]) || 0;
    const inflation = counted > 0 && reported > 0 ? reported / counted : null;
    return {
      key: s.key,
      label: s.label,
      counted,
      reported,
      inflation,
      discarded: reported > 0 ? (reported - counted) / reported : null,
      percentile:
        inflation == null
          ? null
          : percentile(
              inflation,
              series.map((p) => p.ratios[s.key]).filter((v): v is number => v != null)
            ),
    };
  });

  const spot = rows.find((r) => r.key === "total")?.inflation ?? null;
  const deriv = rows.find((r) => r.key === "deriv")?.inflation ?? null;

  return jsonResponse(
    {
      ok: true,
      asOf: q.last_updated ?? null,
      failure: null,
      rows,
      spotVsDerivatives: spot != null && deriv != null ? spot - deriv : null,
      sample: {
        n: series.length,
        from: series[0]?.at ?? null,
        to: series[series.length - 1]?.at ?? null,
      },
      credits: calls.reduce((s, c) => s + c.credits, 0),
      budget: { monthly: BUDGET.monthly(revalidate, 0), routeAllowance: BUDGET.routeAllowance() },
    } satisfies VolumePayload,
    CACHE
  );
}
