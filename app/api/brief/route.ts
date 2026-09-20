import { jsonResponse } from "@/lib/http";
import { briefSession, writeBrief, type Brief } from "@/lib/brief";

// The morning note, written once and then stood by.
//
// One model call per window, not one per reader. The whole point of a standing
// note is that everybody sees the same one, and regenerating it per visitor
// would both cost a call each time and give two people different accounts of
// the same morning.
//
// Held in this process, so a restart loses the archive. That is a real limit
// and it is stated on the panel rather than papered over: the alternative is a
// database this terminal does not otherwise need.

export const dynamic = "force-dynamic";
export const revalidate = 0;

let current: { at: number; brief: Brief } | null = null;
/** Earlier notes, newest first, for as long as this process lives. */
const archive: Brief[] = [];
let inflight: Promise<Brief | null> | null = null;

// Fresh means written in the current session, not written recently. A note
// from 11:58 is stale at 12:01 because the session turned over, and a note from
// 12:01 stands until 18:00 however long that is.
function fresh(): Brief | null {
  if (!current) return null;
  return briefSession(current.at) === briefSession() ? current.brief : null;
}

/** Start the rewrite if one is not already running, and hand back the promise. */
function rewrite(origin: string): Promise<Brief | null> {
  // Coalesced. Several readers arriving at once must not each pay for a note.
  if (!inflight) {
    inflight = writeBrief(origin)
      .catch(() => null)
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

function store(brief: Brief) {
  if (current && current.brief.writtenAt !== brief.writtenAt) {
    archive.unshift(current.brief);
    archive.length = Math.min(archive.length, 8);
  }
  current = { at: Date.now(), brief };
}

export async function GET() {
  const origin = `http://127.0.0.1:${process.env.PORT ?? 3000}`;

  const hit = fresh();
  if (hit) {
    return jsonResponse({ ok: true, brief: hit, archive: archive.slice(0, 4), note: null, rewriting: false }, 300);
  }

  // A note exists, it is just from the previous session. Serve it now and
  // rewrite behind the reader.
  //
  // Writing a note costs five route reads, one of them the flow desk, and then
  // a model call. Awaiting that put the whole chain in front of whoever
  // happened to arrive first after a session turned over, and they watched a
  // skeleton for the length of it while every other panel on the page had
  // already rendered. Nobody else paid anything, which is what made it easy to
  // miss.
  //
  // The previous session's note carries its own timestamp and the panel shows
  // it, so serving it is honest. It is also the more useful answer: a note from
  // this morning is worth more than a spinner.
  const last = current?.brief ?? null;
  if (last) {
    void rewrite(origin).then((brief) => {
      if (brief) store(brief);
    });
    return jsonResponse(
      {
        ok: true,
        brief: last,
        archive: archive.slice(0, 4),
        note: "The session has turned over. This note stood in the last one, and a new one is being written.",
        rewriting: true,
      },
      // Short, because the point of this response is that it is about to be
      // superseded. The panel shortens its own poll on `rewriting` too.
      30
    );
  }

  // Nothing to show at all. This is the only path that waits, and it happens
  // once per container, before instrumentation.ts has warmed it or when that
  // warm failed.
  const brief = await rewrite(origin);

  if (!brief) {
    return jsonResponse(
      {
        ok: false,
        brief: null,
        archive: archive.slice(0, 4),
        note: "No note yet. The model is unavailable.",
        rewriting: false,
      },
      120
    );
  }

  store(brief);
  return jsonResponse({ ok: true, brief, archive: archive.slice(0, 4), note: null, rewriting: false }, 300);
}
