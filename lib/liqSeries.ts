import "server-only";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { concentration } from "./cmc";

// The collected liquidation series, read off disk.
//
// This exists because CoinMarketCap publishes no historical liquidation
// endpoint: rolling 1h, 4h and 24h windows and nothing older. The house rule is
// abnormality over levels, so a concentration reading is worth nothing without
// its own history to rank against, and there is nowhere else to get one.
//
// `scripts/cmc-sample.mjs` writes the series, one file per UTC day under
// `data/liquidations/`, and the Dockerfile copies the directory into the image.
// So the files a running container holds are frozen at build time.
//
// On top of that frozen base, the routes add every fresh reading they make to a
// live tail held in process. A container deployed on 21 September was still
// ranking against its seven build-time samples on the 24th, while the committed
// series had grown to twenty six and the routes had read the same feed every
// twenty minutes in between. The tail costs no credits, because it records reads
// the routes were making anyway. It is lost on restart, which falls back to the
// committed base, the state this was in before.

const DIR = join(process.cwd(), "data", "liquidations");

/** One sample, in the compact shape the sampler writes. */
interface Sample {
  t: string;
  ex: { id: number; n: string; h1: number[]; h24: number[]; h4?: number[] }[];
  /** Volume counted against volume reported, per slice, in millions. */
  vol?: {
    total: [number | null, number | null];
    alt: [number | null, number | null];
    defi: [number | null, number | null];
    stable: [number | null, number | null];
    deriv: [number | null, number | null];
  } | null;
}

/** The slices the sampler records, and the panel reads. */
export type VolSlice = "total" | "alt" | "defi" | "stable" | "deriv";

/** The concentration readings derived from one sample, by window. */
export interface SeriesPoint {
  at: string;
  h1: number | null;
  h4: number | null;
  h24: number | null;
}

export interface Series {
  points: SeriesPoint[];
  from: string | null;
  to: string | null;
}

const EMPTY: Series = { points: [], from: null, to: null };

/**
 * The shortest gap between two samples in the series.
 *
 * The committed sampler runs about every two hours and a route refreshes every
 * twenty minutes. Without a floor the live tail would outnumber the base six to
 * one within a day and the percentile would mostly rank a reading against its
 * own neighbours. Thirty minutes is the cadence the sampler asks for.
 */
const MIN_GAP_MS = 30 * 60 * 1000;

/** Readings recorded by the routes since this process started, oldest first. */
const liveLiq: SeriesPoint[] = [];
const liveVol: { at: string; ratios: Record<VolSlice, number | null> }[] = [];

/** True when `at` is at least MIN_GAP_MS after the newest of `ats`. */
function spaced(at: string, ats: string[]): boolean {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return false;
  const last = ats.length ? Date.parse(ats[ats.length - 1]) : -Infinity;
  return t - last >= MIN_GAP_MS;
}

/**
 * Add a fresh concentration reading to the live tail.
 *
 * Call after ranking the reading, so a value is never ranked against itself.
 */
export async function recordLiq(point: SeriesPoint): Promise<void> {
  const base = await baseLiq();
  if (!spaced(point.at, [base.to ?? "", ...liveLiq.map((p) => p.at)].filter(Boolean))) return;
  liveLiq.push(point);
}

/** Add a fresh volume reading to the live tail. Same rule as `recordLiq`. */
export async function recordVol(point: { at: string; ratios: Record<VolSlice, number | null> }): Promise<void> {
  const base = await baseVol();
  if (!spaced(point.at, [...base, ...liveVol].map((p) => p.at))) return;
  liveVol.push(point);
}

// Read once per process. The files never change under a running container, so
// re-reading them on every refresh would be pure waste, and at 96 samples a day
// the parse is not free.
let cached: Series | null = null;

/**
 * Every sample on disk, oldest first, reduced to its concentration readings.
 *
 * Returns an empty series rather than throwing when the directory is absent,
 * which is the normal state of a fresh clone and of any checkout made before
 * the sampler started.
 */
export async function liqSeries(): Promise<Series> {
  const base = await baseLiq();
  if (!liveLiq.length) return base;
  const points = [...base.points, ...liveLiq];
  return { points, from: points[0].at, to: points[points.length - 1].at };
}

/** The committed samples alone, parsed once per process. */
async function baseLiq(): Promise<Series> {
  if (cached) return cached;

  let files: string[];
  try {
    files = (await readdir(DIR)).filter((f) => f.endsWith(".jsonl")).sort();
  } catch {
    cached = EMPTY;
    return cached;
  }

  const points: SeriesPoint[] = [];
  for (const f of files) {
    let text: string;
    try {
      text = await readFile(join(DIR, f), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let s: Sample;
      try {
        s = JSON.parse(line) as Sample;
      } catch {
        // A partial last line is what an interrupted append looks like. One bad
        // sample is not a reason to lose the day.
        continue;
      }
      if (!s?.t || !Array.isArray(s.ex) || !s.ex.length) continue;
      points.push({
        at: s.t,
        h1: concentration(s.ex.map((x) => x.h1?.[0] ?? 0))?.score ?? null,
        h4: concentration(s.ex.map((x) => x.h4?.[0] ?? 0))?.score ?? null,
        h24: concentration(s.ex.map((x) => x.h24?.[0] ?? 0))?.score ?? null,
      });
    }
  }

  points.sort((a, b) => a.at.localeCompare(b.at));
  cached = {
    points,
    from: points[0]?.at ?? null,
    to: points[points.length - 1]?.at ?? null,
  };
  return cached;
}

/**
 * Where a value sits in a sample, as a percentile from 0 to 100.
 *
 * Returns null under `minSample`, because a percentile against nine readings is
 * a number with the confidence of a real one and none of the content. The panel
 * says the sample is too short instead of printing it, which is the same
 * discipline the flow desk learned: a desk missing most of its data renders
 * exactly like a full one.
 */
export function percentile(value: number, sample: number[], minSample = 30): number | null {
  const vs = sample.filter((v) => Number.isFinite(v));
  if (vs.length < minSample) return null;
  const below = vs.filter((v) => v < value).length;
  const equal = vs.filter((v) => v === value).length;
  // Midpoint of the tied block, so a run of identical quiet hours does not put
  // every one of them at the top of its own distribution.
  return Math.round((100 * (below + equal / 2)) / vs.length);
}


/**
 * The reported-over-counted volume ratio per slice, oldest first.
 *
 * Read from the same files as `liqSeries`, because they are the same samples.
 * Kept separate because a caller wants one or the other and parsing the whole
 * day to compute both would be work thrown away either way.
 *
 * Samples written before the sampler recorded volume have no `vol` field, and
 * they are skipped rather than counted as zero. A ratio of zero would sit at
 * the bottom of every percentile and drag the reading down for as long as those
 * early samples survive.
 */
export async function volSeries(): Promise<{ at: string; ratios: Record<VolSlice, number | null> }[]> {
  return [...(await baseVol()), ...liveVol];
}

let cachedVol: { at: string; ratios: Record<VolSlice, number | null> }[] | null = null;

/** The committed volume samples alone, parsed once per process. */
async function baseVol(): Promise<{ at: string; ratios: Record<VolSlice, number | null> }[]> {
  if (cachedVol) return cachedVol;
  const out: { at: string; ratios: Record<VolSlice, number | null> }[] = [];

  let files: string[];
  try {
    files = (await readdir(DIR)).filter((f) => f.endsWith(".jsonl")).sort();
  } catch {
    cachedVol = out;
    return out;
  }

  const SLICES: VolSlice[] = ["total", "alt", "defi", "stable", "deriv"];

  for (const f of files) {
    let text: string;
    try {
      text = await readFile(join(DIR, f), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let s: Sample;
      try {
        s = JSON.parse(line) as Sample;
      } catch {
        continue;
      }
      if (!s?.t || !s.vol) continue;
      const ratios = {} as Record<VolSlice, number | null>;
      for (const k of SLICES) {
        const pair = s.vol[k];
        const counted = pair?.[0];
        const reported = pair?.[1];
        ratios[k] = counted && reported && counted > 0 ? reported / counted : null;
      }
      out.push({ at: s.t, ratios });
    }
  }

  out.sort((a, b) => a.at.localeCompare(b.at));
  cachedVol = out;
  return out;
}
