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
// So what a running container holds is frozen at build time. That is stated on
// the panel rather than hidden: a sample that stops three weeks ago is still a
// usable reference, and a reader who cannot see the window cannot tell.

const DIR = join(process.cwd(), "data", "liquidations");

/** One sample, in the compact shape the sampler writes. */
interface Sample {
  t: string;
  ex: { id: number; n: string; h1: number[]; h24: number[]; h4?: number[] }[];
}

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
