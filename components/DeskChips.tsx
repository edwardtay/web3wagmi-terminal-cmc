"use client";

// The desks an answer read, as chips that open the panel each one came from.
//
// One map for every surface that shows an answer (the chat bubble, the command
// palette, the Graph page), because three copies had already drifted: a tool
// added to one rendered as its raw name in the others. A reader who wants to
// check a number should be one click from the panel that holds it, so each
// chip links to its section on the terminal. Paths are rooted at "/" so they
// work from /cmc and /thegraph as well as from the home page.

const DESKS: Record<string, { label: string; href?: string }> = {
  dislocation_queue: { label: "what changed", href: "/#signals" },
  exchange_flow: { label: "exchange flow", href: "/#netflow" },
  derivatives: { label: "funding", href: "/#funding" },
  liquidations_all_venues: { label: "liquidations", href: "/#forced" },
  fee_leaders: { label: "fees", href: "/#earners" },
  compare_protocols: { label: "protocols", href: "/thegraph#standards" },
  query_uniswap_subgraph: { label: "uniswap", href: "/thegraph" },
  // Press coverage has no panel of its own, so it stays a label.
  market_coverage: { label: "coverage" },
};

export function deskLabel(tool: string): string {
  return DESKS[tool]?.label ?? tool;
}

export function DeskChips({
  tools,
  className = "",
  onOpen,
}: {
  tools: string[];
  className?: string;
  /** Called when a chip is followed, so a modal holding the answer can close and show the panel. */
  onOpen?: () => void;
}) {
  const unique = [...new Set(tools)];
  if (!unique.length) return null;
  return (
    <p className={`flex flex-wrap items-center gap-1 font-mono text-[9px] text-[var(--text3)] ${className}`}>
      <span>read</span>
      {unique.map((t) => {
        const d = DESKS[t];
        const chip = "rounded border border-[var(--border)] bg-[var(--bg2)] px-1 py-px text-[var(--text2)]";
        return d?.href ? (
          <a
            key={t}
            href={d.href}
            className={`${chip} underline-offset-2 hover:border-[var(--accent)] hover:text-[var(--text)] hover:underline`}
            title={`Open the ${d.label} panel`}
            onClick={onOpen}
          >
            {d.label}
          </a>
        ) : (
          <span key={t} className={chip}>
            {deskLabel(t)}
          </span>
        );
      })}
    </p>
  );
}
