"use client";

import { useEffect, useRef, useState } from "react";

// Desktop-only section rail. The page is long enough that a reader loses their
// place, so the rail tracks which section is on screen. Below xl it is hidden
// and the horizontal strip in TerminalHeader carries navigation instead, since
// a fixed side column would eat most of a 360px viewport.

// Exported so the mobile strip in TerminalHeader lists exactly the same
// sections. One source, so the two navigations cannot drift apart.
export const SECTION_GROUPS: { label: string; items: { id: string; label: string }[] }[] = [
  {
    label: "Glance",
    items: [
      { id: "brief", label: "The brief" },
      { id: "signals", label: "What changed" },
      { id: "snapshot", label: "Snapshot" },
      { id: "earners", label: "Fees and revenue" },
    ],
  },
  {
    label: "Market wide",
    items: [
      { id: "stress", label: "Stress index" },
      { id: "live", label: "Live board" },
      { id: "volume", label: "Volume quality" },
    ],
  },
  // The focused instrument gets its own group because it is the one part of
  // the page the focus control changes. Splitting these across Glance, Tape and
  // Derivatives is what made the control look inert: nothing in the nav said
  // which sections answered to it.
  {
    label: "Focused instrument",
    items: [
      { id: "focus", label: "Chart and context" },
      { id: "microstructure", label: "Order flow" },
      { id: "options", label: "Options" },
    ],
  },
  {
    label: "Derivatives",
    items: [
      { id: "funding", label: "Funding" },
      { id: "oi", label: "Open interest" },
      { id: "liquidations", label: "Liquidations" },
      { id: "forced", label: "Forced selling" },
      { id: "leverage", label: "Leverage cleared" },
    ],
  },
  {
    label: "On-chain",
    items: [
      { id: "netflow", label: "Exchange flow" },
      { id: "agents", label: "Agents" },
      { id: "dex", label: "DEX pools" },
      { id: "chains", label: "Chains" },
      { id: "protocols", label: "Protocols" },
      { id: "stablecoins", label: "Stablecoins" },
      { id: "yields", label: "Yields" },
      { id: "gas", label: "Gas" },
      { id: "unlocks", label: "Unlocks" },
    ],
  },
  {
    label: "Analytics",
    items: [
      { id: "returns", label: "Returns" },
      { id: "risk", label: "Risk" },
      { id: "correlation", label: "Correlation" },
      { id: "breadth", label: "Breadth" },
      { id: "rotation", label: "Rotation" },
      { id: "screener", label: "Screener" },
    ],
  },
];

const IDS = SECTION_GROUPS.flatMap((g) => g.items.map((i) => i.id));

export function SideNav() {
  const active = useActiveSection();
  return <DesktopRail active={active} />;
}

/** How much sticky furniture sits above the content, right now. */
function chromeHeight(): number {
  if (typeof document === "undefined") return 150;
  // The section strip lives inside the header, so the header's own bottom edge
  // already accounts for it. Measuring both and adding them, as an earlier
  // version did, pushed the boundary a strip's height too far down the page.
  const header = document.querySelector("header");
  const bottom = header?.getBoundingClientRect().bottom ?? 0;
  // A floor, because at a scroll position where the header has been pushed up
  // the measurement understates what will cover the content once it settles.
  return Math.max(150, Math.round(bottom));
}

/**
 * Which section is on screen.
 *
 * Extracted so the mobile bar and the desktop rail cannot disagree about it.
 * They did not disagree before only because the mobile bar did not exist: the
 * rail is xl and up, so a phone had no section tracking at all, which is the
 * screen where losing your place in a page this long matters most.
 */
export function useActiveSection(): string {
  const [active, setActive] = useState<string>("snapshot");

  useEffect(() => {
    const seen = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.intersectionRatio);
        // The section occupying the most of the viewport wins, which keeps the
        // highlight stable while a tall panel scrolls past.
        let best = "";
        let bestRatio = 0;
        for (const id of IDS) {
          const r = seen.get(id) ?? 0;
          if (r > bestRatio) {
            bestRatio = r;
            best = id;
          }
        }
        if (best && bestRatio > 0) setActive(best);
      },
      // The top margin matches the stacked sticky chrome so a section counts as
      // on screen only once it clears it. Measured rather than hardcoded: the
      // chrome is a different height on a phone, which now carries a pinned
      // section bar the desktop does not, and a fixed 150px there marked a
      // section active while it was still behind the bar naming it.
      { rootMargin: `-${chromeHeight()}px 0px -40% 0px`, threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] }
    );
    for (const id of IDS) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, []);

  return active;
}

function DesktopRail({ active }: { active: string }) {
  const railRef = useRef<HTMLElement>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);

  // Keep the marked entry in view, scrolling the rail and never the page.
  //
  // The mobile chip strip in TerminalHeader has done this along its own axis
  // since it was built; the rail was the half that never got it. Twenty-seven
  // entries do not fit in a viewport, so on a long page the highlight moved to
  // an item the reader could not see and the rail stopped answering the one
  // question it exists for, which is where am I.
  //
  // Unlike the strip, this only moves when it has to. The strip centres on
  // every change because a horizontal bar shows five chips and the active one
  // is usually near an edge. A vertical rail shows twenty, so re-centring each
  // time a neighbouring section scrolled past would slide the whole list under
  // the reader for no gain. Out of view, or close to an edge, it centres. In
  // comfortable view, it stays still.
  useEffect(() => {
    const rail = railRef.current;
    const el = activeRef.current;
    if (!rail || !el) return;

    const r = rail.getBoundingClientRect();
    const e = el.getBoundingClientRect();
    // A row's worth of margin, so an entry sitting right on the edge counts as
    // out of view. Landing flush against the top of the rail reads as clipped.
    const margin = 44;
    if (e.top >= r.top + margin && e.bottom <= r.bottom - margin) return;

    rail.scrollTo({
      top: rail.scrollTop + (e.top - r.top) - (r.height - e.height) / 2,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }, [active]);

  return (
    <nav
      ref={railRef}
      aria-label="Terminal sections"
      className="thin-scroll sticky top-[140px] hidden max-h-[calc(100vh-160px)] w-44 shrink-0 overflow-y-auto pb-6 xl:block"
    >
      {SECTION_GROUPS.map((g) => (
        <div key={g.label} className="mb-4">
          {/* The group label is the thing that makes this a structure rather
              than a list of twenty-seven links, and it was the faintest text
              on the rail: --text3 at 9px, lighter than the entries beneath it,
              so the groups it names read as gaps. A rule and a darker weight
              cost nothing and let the eye find "Derivatives" without reading
              it. */}
          <div className="mb-1.5 border-b border-[var(--border)] px-2 pb-1 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--text2)]">
            {g.label}
          </div>
          <ul className="space-y-0.5">
            {g.items.map((i) => {
              const on = active === i.id;
              return (
                <li key={i.id}>
                  <a
                    href={`#${i.id}`}
                    ref={on ? activeRef : undefined}
                    aria-current={on ? "true" : undefined}
                    className={`block rounded-md border-l-2 px-2 py-1 text-[12px] font-semibold transition-colors ${
                      on
                        ? "border-[var(--accent2)] bg-[var(--accent-soft)] text-[var(--text)]"
                        : "border-transparent text-[var(--text3)] hover:bg-[var(--surface2)] hover:text-[var(--text2)]"
                    }`}
                  >
                    {i.label}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
