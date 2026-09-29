import "server-only";
import { REGIME_MEANING } from "@/app/api/derivs/route";
import type { ForcedPayload, LiqRead } from "@/app/api/forced/route";
import type { LeveragePayload } from "@/app/api/leverage/route";
import type { VolumePayload } from "@/app/api/volume/route";
import { askReady, chat, plain, readRoute, tighten, type Session } from "./ask";
// Compact, not exact. The note is prose: "$48,232,273.99 left USDT reserves"
// is a number nobody reads aloud, and it spends the completion budget on
// digits that carry no more meaning than "$48.2m".
import { ordinal, pctPlain, usdCompact } from "./format";

// The brief the terminal writes by itself.
//
// Everything else here answers a question. This one is not asked: it runs on a
// schedule, reads every desk, and writes down what a person coming to the
// market this morning would want told to them. That difference is the point.
// A terminal that answers when poked is a reference; one that has already
// looked is a colleague who got in early.
//
// One model call a day. The desks it reads are the same routes the assistant's
// tools read, so a brief cannot contain a number the terminal cannot show, and
// the evidence is assembled in code rather than gathered by the model: it is
// handed the readings and asked only to write them up.
//
// Deliberately not a forecast. It says what changed and what is unusual, and
// where a reading has a conventional meaning it says that, which is the same
// contract every other panel here keeps.

/**
 * Below this many words the model did not write a note, whatever it returned.
 *
 * The prompt asks for three or four sentences of eighteen to twenty two words,
 * so the shortest legitimate note is around forty five. Thirty leaves room for
 * a terse day without admitting a fragment.
 */
const MIN_BRIEF_WORDS = 30;

/** How long a brief stands before another is written. */
export const BRIEF_TTL = 6 * 60 * 60;

/**
 * The UTC session a moment falls in, counted from the epoch.
 *
 * The window is anchored to the clock rather than to whenever the first reader
 * happened to arrive. A drifting six hours means the note is rewritten at
 * 04:12 one day and 09:47 the next, so nobody can say when the current one was
 * written or when the next is due, and two readers an hour apart can be looking
 * at notes from different windows with no way to tell.
 *
 * Anchored, the boundaries land on 00:00, 06:00, 12:00 and 18:00 UTC, because
 * the epoch itself starts at midnight UTC and six divides the day evenly. Those
 * are roughly the session handovers: Asia into Europe, Europe into New York,
 * the US close, and the quiet hours after it.
 */
export function briefSession(ms: number = Date.now()): number {
  return Math.floor(ms / (BRIEF_TTL * 1000));
}

/** That session as a label a reader can check against a clock. */
export function sessionLabel(ms: number = Date.now()): string {
  const start = new Date(briefSession(ms) * BRIEF_TTL * 1000);
  const hh = String(start.getUTCHours()).padStart(2, "0");
  return `${start.toISOString().slice(0, 10)} ${hh}:00 UTC`;
}

export interface Brief {
  /** The day this brief describes, in UTC. */
  date: string;
  /** The six-hour session it belongs to, such as "2026-09-09 12:00 UTC". */
  session: string;
  writtenAt: string;
  text: string;
  /** Which desks were readable when it was written. */
  read: string[];
  /** Desks that could not be reached, named rather than silently dropped. */
  missing: string[];
  /**
   * The CoinMarketCap readings behind the note, computed in code and shown
   * beside it, so a reader can check the prose against the feed it came from.
   * Absent on notes written before the field existed.
   */
  cmc?: CmcFigure[];
  /** The setups the note was built from, shown under it so they stand without the prose. */
  setups?: Setup[];
}

export interface CmcFigure {
  label: string;
  value: string;
  detail: string;
  /** The panel on the page that carries the full reading. */
  href: string;
}

/**
 * What each per-coin liquidation read means, handed to the model with the read
 * so it never has to infer direction from which side was liquidated. Mirrors
 * the definitions on `LiqRead` in the forced route.
 */
const LIQ_MEANING: Record<LiqRead, string> = {
  squeeze: "shorts carried most of it while the price rose; the forced buying is part of the rise",
  flush: "longs carried most of it while the price fell; the forced selling is part of the fall",
  against: "the losing side is the one the move favoured, so a wick went the other way first",
  absorbed: "one side carried two thirds and the price barely moved, so the market took it",
  "two-sided": "neither side carried two thirds, so no side was forced out",
};

interface Signals {
  signals?: { kind: string; symbol: string | null; headline: string; evidence: string; severity: number }[];
}
interface Netflow {
  tokens?: { sym: string; reservesUsd: number | null; flowUsd?: { h24: number | null } | null; holders?: { holders: number; topShare: number | null } | null }[];
  coverage?: { wallets: number; walletsTracked: number };
}
interface Derivs {
  funding?: { sym: string; annual: number; hlAnnual: number | null }[];
  oi?: { sym: string; regime: string; oiChangePct: number | null; priceChangePct?: number | null }[];
  hlPlatform?: { volumeUsd: number; buyUsd: number; liquidationsUsd: number } | null;
}
interface Breadth {
  above50?: { n: number; total: number };
  ad24?: { up: number; down: number };
  outperf7?: { n: number; total: number };
}
interface Stress {
  score?: number;
  percentile?: number;
  band?: { label: string };
}

/** Smallest 24h exchange flow worth a sentence, in USD. */
const FLOW_FLOOR_USD = 1_000_000;

const round = (n: number | null | undefined, d = 1): number | null =>
  n == null || !Number.isFinite(n) ? null : Number(n.toFixed(d));

/**
 * Everything the brief is allowed to mention, gathered in code.
 *
 * The model is handed this and nothing else. It cannot call a tool, so it
 * cannot go looking for a number that suits a sentence it has already decided
 * to write, which is the failure mode of a model asked to survey rather than to
 * answer.
 */
async function evidence(
  origin: string
): Promise<{ facts: Record<string, unknown>; read: string[]; missing: string[]; cmc: CmcFigure[]; setups: Setup[] }> {
  // The three CMC routes cache their upstream calls on their own windows, so
  // reading them here spends no credits beyond what the panels already spend.
  const [sig, flow, der, bre, str, forced, lev, vol] = await Promise.all([
    readRoute<Signals>(origin, "/api/signals"),
    readRoute<Netflow>(origin, "/api/netflow"),
    readRoute<Derivs>(origin, "/api/derivs"),
    readRoute<Breadth>(origin, "/api/breadth"),
    readRoute<Stress>(origin, "/api/stress"),
    readRoute<ForcedPayload>(origin, "/api/forced"),
    readRoute<LeveragePayload>(origin, "/api/leverage"),
    readRoute<VolumePayload>(origin, "/api/volume"),
  ]);

  const read: string[] = [];
  const missing: string[] = [];
  const facts: Record<string, unknown> = {};
  const cmc: CmcFigure[] = [];

  if (sig?.signals) {
    read.push("what changed");
    facts.abnormalNow = sig.signals.slice(0, 5).map((s) => ({
      kind: s.kind,
      asset: s.symbol,
      finding: s.headline,
      evidence: s.evidence,
    }));
  } else missing.push("the dislocation queue");

  if (flow?.tokens) {
    read.push("exchange flow");
    // Below a million a day a flow is noise on a desk measured in billions, and
    // handed over it gets written up: "-$465.96K of USDC leaving" once led a
    // sentence about buying power.
    facts.exchangeFlow = flow.tokens.filter((r) => Math.abs(r.flowUsd?.h24 ?? 0) >= FLOW_FLOOR_USD).map((r) => ({
      asset: r.sym,
      reserves: usdCompact(r.reservesUsd),
      flow24h: usdCompact(r.flowUsd?.h24 ?? null),
      // Stated rather than left to be inferred: the sign means opposite things
      // on a stablecoin and on a coin.
      reading:
        r.flowUsd?.h24 == null
          ? null
          : r.sym === "USDT" || r.sym === "USDC"
            ? r.flowUsd.h24 > 0
              ? "buying power arriving"
              : "buying power leaving"
            : r.flowUsd.h24 > 0
              ? "supply arriving that can be sold"
              : "supply leaving, less to sell",
    }));
    facts.exchangeFlowScope = `${flow.coverage?.wallets ?? 0} of ${flow.coverage?.walletsTracked ?? 0} labelled Ethereum wallets`;
  } else missing.push("exchange flow");

  if (der?.funding) {
    read.push("funding and open interest");
    const crowded = [...der.funding].sort((a, b) => Math.abs(b.annual) - Math.abs(a.annual)).slice(0, 4);
    facts.mostCrowdedFunding = crowded.map((f) => ({
      asset: f.sym,
      binanceAnnualisedPercent: round(f.annual),
      hyperliquidAnnualisedPercent: round(f.hlAnnual),
    }));
    facts.openInterestRegimes = (der.oi ?? []).slice(0, 5).map((o) => ({
      asset: o.sym,
      regime: o.regime,
      contractChange24hPercent: round(o.oiChangePct),
    }));
    if (der.hlPlatform && der.hlPlatform.volumeUsd > 0) {
      facts.onchainPerpVenue = {
        buySharePercent: round((der.hlPlatform.buyUsd / der.hlPlatform.volumeUsd) * 100),
        volume: usdCompact(der.hlPlatform.volumeUsd),
        liquidations: usdCompact(der.hlPlatform.liquidationsUsd),
      };
    }
  } else missing.push("derivatives");

  if (bre?.above50) {
    read.push("breadth");
    facts.breadth = {
      aboveFiftyDay: `${bre.above50.n} of ${bre.above50.total}`,
      risingVsFalling: bre.ad24 ? `${bre.ad24.up} up, ${bre.ad24.down} down` : null,
      beatingBitcoin7d: bre.outperf7 ? `${bre.outperf7.n} of ${bre.outperf7.total}` : null,
    };
  } else missing.push("breadth");

  if (str?.score != null) {
    read.push("stress");
    facts.stress = {
      score: round(str.score, 0),
      band: str.band?.label ?? null,
      percentileOfOwnYear: round(str.percentile, 0),
    };
  } else missing.push("the stress composite");

  cmcEvidence(forced, lev, vol, facts, read, missing, cmc);

  const setups = findSetups(der, forced, lev, flow, sig);
  if (setups.length) facts.setups = setups;

  // One legend for every regime and liquidation read above. Repeating the
  // meaning on each row doubled the prompt, and on the free tier the prompt
  // plus the model's reasoning ran past its tokens-a-minute cap and 429'd.
  facts.legend = {
    openInterestRegime: REGIME_MEANING,
    liquidationRead: LIQ_MEANING,
  };

  // Readings at the edge of their own history. A level is only news against
  // its reference, so these are handed over pre-sorted as the candidates for
  // the opening sentence.
  const extremes: { reading: string; percentile: number }[] = [];
  const edge = (reading: string, p: number | null | undefined) => {
    if (p != null && (p >= 85 || p <= 15)) extremes.push({ reading, percentile: Math.round(p) });
  };
  const w24 = forced?.ok ? forced.windows?.["24h"] : null;
  const w1 = forced?.ok ? forced.windows?.["1h"] : null;
  edge("forced orders, 24h total across nine venues", w24?.totalPercentile);
  edge("forced orders, last hour total across nine venues", w1?.totalPercentile);
  edge("forced orders, concentration on one venue, 24h", w24?.scorePercentile);
  for (const r of vol?.ok ? vol.rows : []) edge(`${r.label}: ratio of reported to counted volume (volume quality, high means more uncounted volume)`, r.percentile);
  edge("stress composite against its own year", str?.percentile);
  if (extremes.length) {
    facts.atTheEdgeOfTheirHistory = extremes.sort((a, b) => Math.abs(b.percentile - 50) - Math.abs(a.percentile - 50));
  }

  return { facts, read, missing, cmc, setups };
}

/**
 * A condition worth acting on, found in code by joining desks.
 *
 * The model given raw readings wrote "hinting buying pressure" and quoted a
 * percentile with no consequence: it described the page back to the reader.
 * These are the joins a desk analyst makes first, each with the reading that
 * would prove it wrong, so the note has something to say and a level to
 * watch. `strength` orders them; it is a ranking, not a probability.
 */
export interface Setup {
  setup: string;
  asset: string | null;
  evidence: string;
  implication: string;
  invalidatedBy: string;
  strength: number;
}

/**
 * Annualised funding past which one side is paying enough to matter, in percent.
 *
 * Asymmetric on purpose. Binance's default rate is 0.01% every 8h, which is
 * 10.95% a year, so most perps sit there with nobody crowded: at a symmetric 10
 * the long side flagged ETH, ADA and PEPE for paying the floor. Shorts paying
 * anything past 10 is already unusual.
 */
const CROWDED_SHORT_FUNDING = 10;
const CROWDED_LONG_FUNDING = 20;
/** Contract growth in 24h that counts as leverage being added, in percent. */
const OI_BUILD_PCT = 2;

function findSetups(
  der: Derivs | null,
  forced: ForcedPayload | null,
  lev: LeveragePayload | null,
  flow: Netflow | null,
  sig: Signals | null
): Setup[] {
  const out: Setup[] = [];
  const funding = new Map((der?.funding ?? []).map((f) => [f.sym, f]));
  const coins = new Map((forced?.ok ? forced.coins : []).map((c) => [c.symbol, c]));
  const usdtFlow = flow?.tokens?.find((t) => t.sym === "USDT")?.flowUsd?.h24 ?? null;

  // Shorts paying to hold while the price rises: every leg up forces more of
  // them to buy. The rarer and sharper of the two crowded-funding setups.
  for (const f of der?.funding ?? []) {
    if (f.annual > -CROWDED_SHORT_FUNDING) continue;
    const c = coins.get(f.sym);
    const move = c?.by["24h"].priceChange ?? null;
    const squeezing = c?.by["1h"].read === "squeeze" || c?.by["4h"].read === "squeeze";
    if (!squeezing && !(move != null && move > 0)) continue;
    out.push({
      setup: "short squeeze fuel",
      asset: f.sym,
      evidence: `shorts pay ${round(Math.abs(f.annual))}% annualised on Binance${move != null ? ` while price is up ${round(move)}% on the day` : ""}${squeezing ? ", and nine-venue forced orders read squeeze" : ""}`,
      implication: "shorts are paying to hold into a rise, so each leg higher forces more of them to buy",
      invalidatedBy: "funding turns positive",
      strength: Math.abs(f.annual) + (squeezing ? 20 : 0),
    });
  }

  for (const o of der?.oi ?? []) {
    const f = funding.get(o.sym);
    // Leverage added on the long side and paid for: the fuel for a flush.
    if (o.regime === "new longs" && f && f.annual >= CROWDED_LONG_FUNDING && (o.oiChangePct ?? 0) >= OI_BUILD_PCT) {
      out.push({
        setup: "long leverage building",
        asset: o.sym,
        evidence: `open interest contracts up ${round(Math.abs(o.oiChangePct ?? 0))}% with price up, longs paying ${round(f.annual)}% annualised`,
        implication: "new leverage is on the long side and paying for it, which is the fuel for a liquidation cascade if price turns",
        invalidatedBy: "funding cools below 20% annualised or open interest stops rising",
        strength: f.annual + Math.abs(o.oiChangePct ?? 0) * 5,
      });
    }
  }

  // A rally carried by shorts closing has no new buyer behind it yet. It is
  // usually market wide, so it is one setup naming its leaders; listed per coin
  // it filled every slot and crowded out everything else.
  const covering = (der?.oi ?? []).filter((o) => o.regime === "short covering").sort((a, b) => (a.oiChangePct ?? 0) - (b.oiChangePct ?? 0));
  if (covering.length) {
    const fresh = usdtFlow != null && usdtFlow >= FLOW_FLOOR_USD;
    const btc = covering.find((o) => o.sym === "BTC");
    const leaders = covering.slice(0, 2).map((o) => `${o.sym} open interest down ${round(Math.abs(o.oiChangePct ?? 0))}% in contracts`);
    out.push({
      setup: "rally on short covering",
      asset: covering.length === 1 ? covering[0].sym : null,
      evidence: `${covering.length} of ${der?.oi?.length ?? 0} perps rose on falling open interest${btc ? ", BTC among them" : ""}; ${leaders.join(", ")}${fresh ? `; ${usdCompact(usdtFlow)} of USDT arrived on exchanges` : ""}`,
      implication: fresh
        ? "the rise is shorts closing; the stablecoins arriving are the fresh buying that would have to take over once they are done"
        : "the rise is shorts closing with no fresh leverage behind it, so it tends to fade once they are done",
      // Kept short so the model can carry it whole into a sentence.
      invalidatedBy: `${(btc ?? covering[0]).sym} open interest turns up with price, which makes it new longs`,
      strength: covering.length * 4 + (btc ? 15 : 0),
    });
  }

  // The side being forced out changed within the day.
  const day = forced?.ok ? forced.windows?.["24h"] : null;
  const hour = forced?.ok ? forced.windows?.["1h"] : null;
  if (day && hour && day.total > 0 && hour.total > 0) {
    const dayLong = day.long / day.total;
    const hourLong = hour.long / hour.total;
    if ((dayLong >= 2 / 3 && hourLong <= 1 / 3) || (dayLong <= 1 / 3 && hourLong >= 2 / 3)) {
      const nowShorts = hourLong <= 1 / 3;
      out.push({
        setup: "forced side flipped",
        asset: null,
        evidence: `across nine venues the day's forced orders were ${Math.round((nowShorts ? dayLong : 1 - dayLong) * 100)}% ${nowShorts ? "longs" : "shorts"}, the last hour's ${Math.round((nowShorts ? 1 - hourLong : hourLong) * 100)}% ${nowShorts ? "shorts" : "longs"}`,
        implication: nowShorts
          ? "the long flush is over and shorts are now the side being forced to buy"
          : "shorts have been cleared and longs are now the side being forced to sell",
        invalidatedBy: `the hour's forced orders turn back to ${nowShorts ? "longs" : "shorts"}`,
        strength: 45,
      });
    }
  }

  // The coin whose leverage is being cleared hardest relative to its book.
  const ranked = (lev?.ok ? lev.rows : []).filter((r) => r.clearedFraction != null).sort((a, b) => (b.clearedFraction ?? 0) - (a.clearedFraction ?? 0));
  if (ranked.length >= 3) {
    const median = ranked[Math.floor(ranked.length / 2)].clearedFraction ?? 0;
    const top = ranked[0];
    const multiple = median > 0 ? (top.clearedFraction ?? 0) / median : null;
    if (multiple != null && multiple >= 1.5) {
      const longs = top.liquidated24h > 0 ? top.long24h / top.liquidated24h : null;
      out.push({
        setup: "liquidation hotspot",
        asset: top.symbol,
        evidence: `liquidations ${round((top.clearedFraction ?? 0) * 100, 2)}% of open interest over 24h, ${round(multiple)}x the median of ${ranked.length} coins${longs != null ? `, ${Math.round(longs * 100)}% of it longs` : ""}`,
        implication: "this is where positioning is being cleared hardest for its size, so its open interest is the least settled",
        invalidatedBy: `${top.symbol} liquidations fall back toward the median`,
        strength: multiple * 12,
      });
    }
  }

  // Known supply landing on a coin whose perp is already leaning.
  for (const u of (sig?.signals ?? []).filter((x) => x.kind === "unlock" && x.symbol)) {
    const pct = Number(/([\d.]+)% of its supply/.exec(u.headline)?.[1] ?? NaN);
    if (!(pct >= 5)) continue;
    const f = funding.get(u.symbol as string);
    out.push({
      setup: "unlock overhang",
      asset: u.symbol,
      evidence: `${pct}% of supply unlocks ${/in \d+ days?/.exec(u.headline)?.[0] ?? "soon"}, ${u.evidence.split(" at ")[0]}${f ? `; perp funding ${round(f.annual)}% annualised` : ""}`,
      implication: "known new supply on a date, which the market tends to price before the date rather than on it",
      invalidatedBy: "the unlock passes without the price giving ground",
      strength: Math.min(pct, 50),
    });
  }

  // At most two of a kind, so one condition cannot fill the note.
  const seen = new Map<string, number>();
  return out
    .sort((a, b) => b.strength - a.strength)
    .filter((x) => {
      const n = (seen.get(x.setup) ?? 0) + 1;
      seen.set(x.setup, n);
      return n <= 2;
    })
    .slice(0, 5)
    .map((x) => ({ ...x, strength: Math.round(x.strength) }));
}

const share = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part / whole) * 100) : null);

/**
 * The CoinMarketCap desks: forced selling across nine venues, liquidations
 * against sampled open interest, and reported against counted volume.
 *
 * Each one adds a fact for the model and a figure for the strip under the note.
 * The figure is written here from the same payload, so the strip and the prose
 * cannot disagree about a number, and the strip survives a model that chose
 * not to mention the desk.
 */
function cmcEvidence(
  forced: ForcedPayload | null,
  lev: LeveragePayload | null,
  vol: VolumePayload | null,
  facts: Record<string, unknown>,
  read: string[],
  missing: string[],
  cmc: CmcFigure[]
) {
  const day = forced?.ok ? forced.windows?.["24h"] : null;
  const hour = forced?.ok ? forced.windows?.["1h"] : null;
  if (forced && day && hour) {
    read.push("CMC forced selling");
    const window = (w: typeof day) => ({
      total: usdCompact(w.total),
      longsLiquidated: usdCompact(w.long),
      shortsLiquidated: usdCompact(w.short),
      longsLiquidatedPercent: share(w.long, w.total),
      percentileOfCollectedSample: w.totalPercentile,
      largestVenue: w.largestVenue,
      largestVenueSharePercent: round(w.largestShare * 100, 0),
      effectiveVenues: round(w.effectiveVenues, 1),
    });
    facts.forcedSelling = {
      source: `CoinMarketCap liquidations across ${forced.coverage.venues} venues`,
      meaning: "Longs liquidated is forced selling. Shorts liquidated is forced buying.",
      last24h: window(day),
      lastHour: window(hour),
      samplesBehindPercentiles: forced.sample.n,
    };

    const coins = [...forced.coins].sort((a, b) => b.by["24h"].total - a.by["24h"].total).slice(0, 3);
    facts.largestLiquidationsByCoin = coins.map((c) => ({
      asset: c.symbol,
      last24h: usdCompact(c.by["24h"].total),
      priceChange24hPercent: round(c.by["24h"].priceChange),
      read24h: c.by["24h"].read,
      readLastHour: c.by["1h"].read,
    }));

    const longs = share(day.long, day.total);
    cmc.push({
      label: "Forced selling, 24h",
      value: usdCompact(day.total),
      detail: [
        longs == null ? null : longs >= 50 ? `${longs}% longs` : `${100 - longs}% shorts`,
        day.totalPercentile == null ? null : `${ordinal(day.totalPercentile)} pct of ${forced.sample.n} samples`,
        `${forced.coverage.venues} venues, ${day.largestVenue} ${Math.round(day.largestShare * 100)}%`,
      ]
        .filter(Boolean)
        .join(" · "),
      href: "#forced",
    });

    const hourLongs = share(hour.long, hour.total);
    const lead = coins[0];
    cmc.push({
      label: "Forced orders, last hour",
      value: usdCompact(hour.total),
      detail: [
        hourLongs == null ? null : hourLongs >= 50 ? `${hourLongs}% longs` : `${100 - hourLongs}% shorts`,
        lead?.by["1h"].read ? `${lead.symbol} reads ${lead.by["1h"].read}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      href: "#forced",
    });
  } else missing.push("CMC forced selling");

  const rows = lev?.ok ? lev.rows.filter((r) => r.clearedFraction != null) : [];
  if (lev?.ok && rows.length) {
    read.push("CMC liquidations / open interest");
    const longsPay = lev.totals?.fundingLongShare ?? null;
    const ranked = [...rows].sort((a, b) => (b.clearedFraction ?? 0) - (a.clearedFraction ?? 0));
    facts.liquidationsVsOpenInterest = {
      source: "CoinMarketCap, nine-venue 24h liquidations over open interest sampled from a wider venue set",
      caveat:
        "The two sides cover different venues, so this ranks coins by liquidation scale against their open interest. It is never the share of positions closed.",
      highest: ranked.slice(0, 3).map((r) => ({
        asset: r.symbol,
        filteredPercent: round((r.clearedFraction ?? 0) * 100, 3),
        unfilteredPercent: round((r.clearedFractionUnfiltered ?? 0) * 100, 3),
        premiumBps: round(r.premiumBps, 1),
      })),
      fundingLongsPayPercentOfOpenInterest: longsPay == null ? null : round(longsPay * 100, 0),
    };

    const top = ranked[0];
    cmc.push({
      label: "Liquidations / OI, 24h",
      value: `${top.symbol} ${pctPlain((top.clearedFraction ?? 0) * 100, 3)}`,
      detail: [
        `${pctPlain((top.clearedFractionUnfiltered ?? 0) * 100, 3)} unfiltered`,
        longsPay == null ? null : `longs pay funding on ${Math.round(longsPay * 100)}% of OI`,
      ]
        .filter(Boolean)
        .join(" · "),
      href: "#leverage",
    });
  } else missing.push("CMC liquidations / open interest");

  const spot = vol?.ok ? vol.rows.find((r) => r.key === "total") : null;
  const deriv = vol?.ok ? vol.rows.find((r) => r.key === "deriv") : null;
  if (vol && spot?.inflation != null) {
    read.push("CMC volume quality");
    facts.volumeQuality = {
      source: "CoinMarketCap reported against counted volume",
      caveat: "The gap measures what CoinMarketCap chose to count. It does not prove fake trades.",
      spotReportedToCounted: round(spot.inflation, 2),
      spotPercentileOfCollectedSample: spot.percentile,
      derivativesReportedToCounted: round(deriv?.inflation, 2),
    };
    cmc.push({
      label: "Spot volume, reported / counted",
      value: `${spot.inflation.toFixed(1)}x`,
      detail: [
        spot.percentile == null ? null : `${ordinal(spot.percentile)} pct of ${vol.sample.n} samples`,
        deriv?.inflation == null ? null : `derivatives ${deriv.inflation.toFixed(2)}x`,
      ]
        .filter(Boolean)
        .join(" · "),
      href: "#volume",
    });
  } else missing.push("CMC volume quality");
}

const SYSTEM = `You write the morning note for a crypto market terminal. You are given every reading it has and nothing else.

- Three sentences, sixty words at most in all. The first and last under eighteen words. Plain prose, no headings, no bullets, no line breaks.
- A reader gives this fifteen seconds. Write complete, grammatical sentences a trader would say aloud to a colleague, one idea each, at most two numbers each. Cut any clause that carries neither a number nor a consequence.
- The note exists to be acted on. A reader finishes it knowing where positioning is stretched, which way the forced orders run, and what level would change that. A sentence that only restates a reading, with no consequence for positioning, is cut.
- Build it from setups, one setup per sentence. Each sentence is the setup's key fact plus its implication, in that order: "12 of 25 perps rose on falling open interest, so the rally is shorts closing and needs the $65.04M of arriving USDT to take over." Never list facts without the implication. Open on the strongest setup, then the next one or two.
- Open interest changes are in contracts. Always write "open interest down 7.3%", never "ADA down 7.3%", which reads as price.
- Close with "Watch" and the invalidatedBy of the lead setup, in words a trader uses, naming the level. That sentence holds only the watch.
- Write a fall as "down 7.3%" or "fell 7.3%". Never write a minus sign or the word minus. Negative funding is "shorts pay 28% annualised", never "funding down".
- Join facts only about the same asset or about the market as a whole. Two unrelated assets never share a sentence.
- If setups is empty, open on the reading in atTheEdgeOfTheirHistory that bears on positioning. Volume quality is structural context and never the opener.
- Never open by announcing what the note is about, so no "the key thing" and no "the biggest risk".
- Every number carries its meaning in the same clause. "$65m of USDT arrived" says nothing until it says "buying power arriving".
- Never write a field name such as setups or atTheEdgeOfTheirHistory. Never repeat a number already written. Never list three figures in one sentence; join two and give the consequence.
- contractChange24hPercent is the change in open interest contracts, never a price move.
- No connective padding: no "adding to", "underscoring", "this suggests", "meanwhile", "notably", "indicating", "linking", "hinting", "bias", "sentiment". Say which side is forced or paying and what that does to price. State the two facts and the consequence.
- Every number must come from the readings given. If something is not in them, you do not know it.
- Use the reading already attached to a flow rather than deriving direction from a sign. Coins arriving is supply to sell; stablecoins arriving is buying power.
- Same for an open interest regime: use its meaning in legend.openInterestRegime and never infer direction from whether open interest rose or fell. Short covering is upward pressure even though open interest is falling, and long liquidation is downward pressure for the same reason in reverse.
- For a coin's liquidation read, use its meaning in legend.liquidationRead. Never infer direction from which side was liquidated.
- The CoinMarketCap readings (forcedSelling, largestLiquidationsByCoin, liquidationsVsOpenInterest, volumeQuality) cover nine venues where every other desk sees one. At least one of the first two sentences draws on them; call them "across nine venues" once.
- Call liquidationsVsOpenInterest "liquidations relative to open interest". It is never a share of positions closed.
- A gap between reported and counted volume measures what CoinMarketCap counts. Never call it fake volume.
- Name at most three assets, each only where it is the exception that gives the picture its meaning.
- Never recommend a trade or say what to buy or sell. Describe conditions.
- Money is already formatted. Write it exactly as given, such as $168.1m. Percentiles as "92nd percentile".
- Plain ASCII punctuation. No dashes as punctuation. Never write "it is not X, it is Y" or "not X, but Y".

The shape, from an invented day. Its assets and numbers are made up and must never appear in the note:
"Nine of 25 perps fell on rising open interest, so sellers are adding leverage and building fuel for a squeeze. SOL shorts pay 32% annualised into a 4% rise, so each leg higher forces more of them to buy. Watch SOL funding: a turn positive ends the squeeze."`;

/**
 * What the model is actually handed.
 *
 * With setups found, it gets those and the few readings that confirm or
 * contradict them, and nothing to go looking in. Given the whole sheet it
 * reached past the setups for a stray figure and misread it: the day's total
 * forced orders went out as "longs liquidated" twice. The full sheet is only
 * for a day with no setups, when there is nothing better to lead with.
 */
function focus(facts: Record<string, unknown>): Record<string, unknown> {
  if (!facts.setups) return facts;
  const forced = facts.forcedSelling as { last24h?: Record<string, unknown>; lastHour?: Record<string, unknown> } | undefined;
  const brief = (w?: Record<string, unknown>) =>
    w && { total: w.total, longsLiquidated: w.longsLiquidated, shortsLiquidated: w.shortsLiquidated, percentileOfCollectedSample: w.percentileOfCollectedSample };
  return {
    setups: (facts.setups as Setup[]).map(({ strength: _s, ...x }) => x),
    forcedOrdersAcrossNineVenues: forced ? { last24h: brief(forced.last24h), lastHour: brief(forced.lastHour) } : undefined,
    stress: facts.stress,
    breadth: facts.breadth,
  };
}

export async function writeBrief(origin: string): Promise<Brief | null> {
  if (!askReady()) return null;

  const { facts, read, missing, cmc, setups } = await evidence(origin);
  if (read.length === 0) return null;

  const now = new Date();
  const session: Session = { fallbackModel: null };
  const reply = await chat(
    [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: [
          `Write the morning note for ${now.toISOString().slice(0, 10)}.`,
          "",
          JSON.stringify(focus(facts), null, 1),
          "",
          missing.length ? `These desks could not be read: ${missing.join(", ")}. Do not mention them.` : "",
          "Three sentences built from the setups: strongest first, each fact joined to what it means for positioning, then Watch and the level that would invalidate the lead. Describe conditions and never recommend a trade.",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    false,
    session,
    // Room for the reasoning this model does before it writes. At the default
    // the note came back one sentence long with the rest cut off, and at 2000
    // the wider evidence (eight desks and the joins) left it nothing at all:
    // the reply came back empty with the whole budget spent reasoning.
    // Measured 2026-09-29: about 3,600 reasoning tokens before the prose.
    // Groq counts this ceiling against its 8,000 tokens-a-minute cap along
    // with the prompt, so 8000 is refused outright with a 413. Keep the prompt
    // lean for the same reason.
    6000
  );

  const text = reply?.content ? tighten(plain(reply.content)) : null;
  // A floor, because a note is a paragraph and anything shorter is wreckage.
  //
  // "ETH implied volatility is." went out as a morning brief: the model was cut
  // mid-sentence, and every layer below treated a fragment ending in a full
  // stop as prose. Returning null here keeps the previous note standing, which
  // is a better answer than four words.
  if (!text || text.split(/\s+/).length < MIN_BRIEF_WORDS) return null;

  return {
    date: now.toISOString().slice(0, 10),
    session: sessionLabel(now.getTime()),
    writtenAt: now.toISOString(),
    text,
    read,
    missing,
    cmc,
    setups: setups.slice(0, 3),
  };
}
