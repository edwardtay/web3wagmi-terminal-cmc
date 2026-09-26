"use client";

import { useEffect } from "react";

// Keep a #section link landing on its section while the page above it loads.
//
// Opening terminal.web3wagmi.com/#liquidations scrolled to the right place and
// then drifted: the panels above it render as their data arrives, each one
// grows, and the section is pushed down the page after the browser has already
// scrolled. On a reload Chrome also restores the previous scroll position over
// the hash. So the target is re-aligned whenever the layout above it changes,
// until the page settles or the reader takes over.

/** How long to keep correcting. The slow desks answer well inside this. */
const HOLD_MS = 8000;

function pin(hash: string): () => void {
  const id = decodeURIComponent(hash.replace(/^#/, ""));
  if (!id) return () => {};
  let done = false;
  let frame = 0;

  const align = () => {
    if (done) return;
    const el = document.getElementById(id);
    // scroll-margin on each section clears the sticky header.
    if (el) el.scrollIntoView({ block: "start" });
  };

  const stop = () => {
    if (done) return;
    done = true;
    observer.disconnect();
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    for (const ev of ["wheel", "touchstart", "keydown", "mousedown"]) window.removeEventListener(ev, stop);
  };

  // Re-align after any size change, batched to one scroll per frame.
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(align);
  });
  observer.observe(document.body);

  // The reader scrolling, tapping or typing ends it at once.
  for (const ev of ["wheel", "touchstart", "keydown", "mousedown"]) window.addEventListener(ev, stop, { passive: true });
  const timer = setTimeout(stop, HOLD_MS);

  align();
  return stop;
}

export function HashAnchor() {
  useEffect(() => {
    // Without this a reload restores the old scroll position over the hash.
    if (location.hash && "scrollRestoration" in history) history.scrollRestoration = "manual";

    let stop = location.hash ? pin(location.hash) : () => {};
    const onHash = () => {
      stop();
      stop = pin(location.hash);
    };
    window.addEventListener("hashchange", onHash);
    return () => {
      stop();
      window.removeEventListener("hashchange", onHash);
    };
  }, []);
  return null;
}
