import type Lenis from "lenis";

/**
 * Tiny module-level accessor for the single Lenis instance created in
 * <SmoothScroll>. Lets other client components (e.g. the mobile nav) pause
 * Lenis while a full-screen overlay is open.
 *
 * Why this matters: Lenis attaches global touch listeners and can treat the
 * micro-movement of a real finger tap as a scroll gesture, calling
 * preventDefault() — which cancels the click on links inside an open modal.
 * Stopping Lenis while the menu is open makes those taps navigate reliably.
 */
let instance: Lenis | null = null;

export function setLenisInstance(l: Lenis | null) {
  instance = l;
}

export function getLenisInstance(): Lenis | null {
  return instance;
}
