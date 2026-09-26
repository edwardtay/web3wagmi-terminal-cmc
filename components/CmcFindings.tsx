"use client";

import Link from "next/link";
import { Loading, Panel } from "@/components/ui";
import { pctPlain, usdCompact, NA } from "@/lib/format";
import { useApi } from "@/lib/useApi";
import type { ForcedPayload } from "@/app/api/forced/route";
import type { LeveragePayload } from "@/app/api/leverage/route";
import type { VolumePayload } from "@/app/api/volume/route";

// The four readings the CoinMarketCap work exists for, one line each, read live
// from the routes the panels below use. Led by the flagged open interest, which
// is the finding a reader is least likely to know already: the field is in the
// payload and not documented as a feature. The /cmc page opens with these so a
// reader sees the findings before the machinery, and each one links to the
// panel that carries it in full.

interface Finding {
  figure: string;
  claim: string;
  reference: string;
  href: string;
}

function Card({ f }: { f: Finding }) {
  return (
    <Panel>
      <Link href={f.href} className="block">
        <div className="font-mono text-[26px] font-semibold tabular-nums text-[var(--text)]">{f.figure}</div>
        <p className="mt-1 text-[12px] leading-relaxed text-[var(--text)]">{f.claim}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-[var(--text3)]">{f.reference}</p>
      </Link>
    </Panel>
  );
}

export function CmcFindings() {
  const forced = useApi<ForcedPayload>("/api/forced", 300);
  const leverage = useApi<LeveragePayload>("/api/leverage", 900);
  const volume = useApi<VolumePayload>("/api/volume", 900);

  if (forced.loading && leverage.loading && volume.loading) {
    return (
      <Panel>
        <Loading rows={3} />
      </Panel>
    );
  }

  const w = forced.data?.ok ? forced.data.windows?.["24h"] : null;
  const venues = forced.data?.coverage.venues ?? 9;
  const t = leverage.data?.ok ? leverage.data.totals : null;
  const reported = t ? t.openInterest + t.flaggedOpenInterest : 0;
  const btc = leverage.data?.rows.find((r) => r.symbol === "BTC");
  const btcGap =
    btc?.clearedFraction != null && btc.clearedFractionUnfiltered
      ? btc.clearedFraction / btc.clearedFractionUnfiltered
      : null;
  const coins = leverage.data?.coverage.priced ?? 9;
  const venueOi = t?.venueOpenInterest ?? [];
  const oiTotal = venueOi.reduce((s, v) => s + v.openInterest, 0);
  const feedNames = new Set((forced.data?.venues ?? []).map((v) => v.name));
  const feedOiShare =
    oiTotal > 0 ? venueOi.filter((v) => feedNames.has(v.venue)).reduce((s, v) => s + v.openInterest, 0) / oiTotal : null;
  const binanceOiShare = oiTotal > 0 ? (venueOi.find((v) => v.venue === "Binance")?.openInterest ?? 0) / oiTotal : null;
  const spot = volume.data?.ok ? volume.data.rows.find((r) => r.key === "total") : null;
  const deriv = volume.data?.ok ? volume.data.rows.find((r) => r.key === "deriv") : null;

  const findings: Finding[] = [
    {
      figure: t && reported > 0 ? pctPlain((100 * t.flaggedOpenInterest) / reported, 0) : NA,
      claim: `of reported open interest on ${coins} majors sits on trading pairs CoinMarketCap leaves out of its own price or volume figures.`,
      reference: !t
        ? "The open interest read did not answer."
        : btcGap != null
          ? `Leave them out too and Bitcoin's liquidated share of open interest moves ${btcGap.toFixed(1)}x. CoinMarketCap flags their price or volume, not the open interest itself, so both figures are shown.`
          : "Both the filtered and unfiltered figures are shown.",
      href: "#leverage",
    },
    {
      figure: w?.streamedShare != null ? pctPlain(100 * w.streamedShare, 0) : NA,
      claim: `of 24h liquidations on the ${venues} venues CoinMarketCap reports happened on Binance, the one venue the terminal's tape streams.`,
      reference: !w
        ? "The liquidation feed did not answer."
        : feedOiShare != null && binanceOiShare != null
          ? `Those ${venues} hold ${pctPlain(100 * feedOiShare, 0)} of vouched-for open interest; Binance alone holds ${pctPlain(100 * binanceOiShare, 0)}. CoinMarketCap is owned by Binance.`
          : `The other ${usdCompact(w.total * (1 - (w.streamedShare ?? 0)))} was spread over ${venues - 1} more venues.`,
      href: "#forced",
    },
    {
      figure: t?.fundingLongShare != null ? pctPlain(100 * t.fundingLongShare, 0) : NA,
      claim: "of the vouched-for open interest is on venues where longs are paying funding.",
      reference: "Read across forty to fifty venues per coin from the same call, for no extra credits. An even split is 50%.",
      href: "#leverage",
    },
    {
      figure: spot?.inflation != null ? `${spot.inflation.toFixed(1)}x` : NA,
      claim: "spot volume reported against what CoinMarketCap will count.",
      reference:
        deriv?.inflation != null
          ? `Derivatives come in at ${deriv.inflation.toFixed(2)}x, so the inflation sits on spot books. This read is keyless and costs nothing.`
          : "The volume read did not answer.",
      href: "#volume",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {findings.map((f) => (
        <Card key={f.href + f.claim} f={f} />
      ))}
    </div>
  );
}
