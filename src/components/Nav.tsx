"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import Button from "@/components/Button";
import { asset } from "@/lib/asset";
import { getLenisInstance } from "@/lib/lenis";
import { SpineSvg } from "@/components/AnatomicalArt";

/* ── Data ──────────────────────────────────────────────────── */

const NAV_LINKS = [
  { href: "/approach", label: "Approach" },
  { href: "/programs/prevent", label: "Prevent" },
  { href: "/about", label: "About Dr.\u00A0Shruthi" },
  { href: "/team", label: "Our Team" },
  { href: "/pricing", label: "Pricing" },
] as const;

/* ── Component ─────────────────────────────────────────────── */

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const prefersReduced = useReducedMotion();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  /* Scroll listener */
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY >= 10);
    onScroll(); // initial check
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  /* Close on route change */
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  /* Close on Escape */
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  /* Lock body scroll + pause Lenis when overlay open.
     Pausing Lenis is essential on touch devices: otherwise the micro-movement
     of a finger tap is read by Lenis as a scroll gesture and preventDefault()'d,
     which cancels the click on the menu links (the menu closes but never
     navigates). Stopping Lenis while open makes the links tap through reliably. */
  useEffect(() => {
    const lenis = getLenisInstance();
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
      lenis?.stop();
    } else {
      document.body.style.overflow = "";
      lenis?.start();
    }
    return () => {
      document.body.style.overflow = "";
      getLenisInstance()?.start();
    };
  }, [mobileOpen]);

  /* Focus management — move focus only when the menu actually opens/closes
     via user action. Skip the initial mount so the hamburger isn't
     auto-focused (which stole focus and flashed a focus ring on page load). */
  const firstFocusRun = useRef(true);
  useEffect(() => {
    if (firstFocusRun.current) {
      firstFocusRun.current = false;
      return;
    }
    if (mobileOpen) {
      closeBtnRef.current?.focus();
    } else {
      toggleRef.current?.focus();
    }
  }, [mobileOpen]);

  const toggleMenu = useCallback(() => {
    setMobileOpen((prev) => !prev);
  }, []);

  /* ── Hamburger icon lines ────────────────────────────────── */
  const lineClass =
    "block h-[2px] w-6 bg-ink transition-all duration-400 ease-[cubic-bezier(0.16,1,0.3,1)]";

  return (
    <>
      {/* ── Sticky bar ──────────────────────────────────────── */}
      <header
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          scrolled
            ? "frosted border-b border-line"
            : "bg-transparent border-b border-transparent"
        }`}
      >
        <nav className="container-site flex items-center justify-between h-16 md:h-[72px]">
          {/* ── Logo ──────────────────────────────────────── */}
          <Link href="/" className="flex items-center gap-2.5 group shrink-0" aria-label="Reconnect home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={asset("/brand/logo.png")} alt="" aria-hidden="true" className="h-9 w-9 object-contain" />
            <span
              className="text-[1.05rem] font-semibold tracking-[0.04em] text-ink leading-none"
              style={{ fontFamily: "var(--font-brand)" }}
            >
              RECONNECT
            </span>
          </Link>

          {/* ── Desktop links (center) ────────────────────── */}
          <ul className="hidden xl:flex items-center gap-6 2xl:gap-8">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className={`text-body-sm font-medium transition-colors duration-200 ${
                    pathname === link.href
                      ? "text-ink"
                      : "text-ink-soft hover:text-ink"
                  }`}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>

          {/* ── Desktop CTA (right) ───────────────────────── */}
          <div className="hidden xl:block shrink-0">
            <Button variant="clay" href="/assessment" size="md" className="whitespace-nowrap">
              Take the free assessment
            </Button>
          </div>

          {/* ── Mobile hamburger ──────────────────────────── */}
          <button
            ref={toggleRef}
            onClick={toggleMenu}
            className="xl:hidden flex flex-col justify-center items-center gap-[5px] w-10 h-10 -mr-2"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
          >
            <span
              className={`${lineClass} origin-center ${
                mobileOpen
                  ? "rotate-45 translate-y-[6.5px]"
                  : ""
              }`}
            />
            <span
              className={`${lineClass} ${
                mobileOpen ? "opacity-0 scale-x-0" : ""
              }`}
            />
            <span
              className={`${lineClass} origin-center ${
                mobileOpen
                  ? "-rotate-45 -translate-y-[6.5px]"
                  : ""
              }`}
            />
          </button>
        </nav>
      </header>

      {/* ── Mobile full-screen overlay ──────────────────────── */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            role="dialog"
            aria-label="Navigation menu"
            aria-modal="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            data-lenis-prevent
            className="fixed inset-0 z-[60] bg-bone flex flex-col xl:hidden overflow-hidden"
          >
            {/* Top bar with close */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-line/10">
              <Link
                href="/"
                className="flex items-center gap-2 shrink-0"
                onClick={() => setMobileOpen(false)}
              >
                {/* Logo */}
                <img src={asset("/brand/logo.png")} alt="" aria-hidden="true" className="h-6 w-6 object-contain" />
                {/* Brand name */}
                <span className="text-sm font-bold text-ink" style={{ fontFamily: "var(--font-brand)" }}>
                  RECONNECT
                </span>
              </Link>

              <button
                ref={closeBtnRef}
                onClick={() => setMobileOpen(false)}
                className="w-8 h-8 flex items-center justify-center"
                aria-label="Close menu"
              >
                <span className="text-2xl font-light text-ink">×</span>
              </button>
            </div>

            {/* Links */}
            <nav className="px-6 flex-1 flex flex-col justify-center gap-6 pb-32">
              {NAV_LINKS.map((link, i) => {
                const isActive = pathname === link.href;
                return (
                  <motion.div
                    key={link.href}
                    initial={
                      prefersReduced
                        ? { opacity: 0 }
                        : { opacity: 0, x: -20 }
                    }
                    animate={
                      prefersReduced
                        ? { opacity: 1 }
                        : { opacity: 1, x: 0 }
                    }
                    transition={{
                      duration: 0.4,
                      ease: [0.16, 1, 0.3, 1],
                      delay: 0.08 * i,
                    }}
                  >
                    <Link
                      href={link.href}
                      onClick={() => setMobileOpen(false)}
                      className={`text-3xl font-bold block transition-colors duration-200 ${
                        isActive
                          ? "text-clay"
                          : "text-ink"
                      }`}
                    >
                      {link.label}
                    </Link>
                  </motion.div>
                );
              })}
            </nav>

            {/* CTA pinned to bottom */}
            <div className="fixed bottom-0 left-0 right-0 p-6 bg-bone border-t border-line/10">
              <Button
                variant="clay"
                href="/assessment"
                size="lg"
                className="w-full justify-center"
                arrow
              >
                Take the free assessment
              </Button>
            </div>

            {/* Anatomical motif */}
            <SpineSvg className="absolute bottom-8 right-8 w-32 opacity-5 text-ink pointer-events-none" />
          </motion.div>
        )}
      </AnimatePresence>

    </>
  );
}
