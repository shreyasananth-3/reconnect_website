/**
 * Lead capture → Google Sheets.
 *
 * The site is statically exported (GitHub Pages) and also runs on Vercel, so
 * there is no shared server runtime. Form submissions are therefore sent
 * directly from the browser to a Google Apps Script Web App bound to the
 * leads spreadsheet (see docs/google-sheets-apps-script.js for the script +
 * setup steps). Set the deployed `…/exec` URL in NEXT_PUBLIC_LEADS_ENDPOINT.
 *
 * If the endpoint is not configured, submitLead() resolves `false` and the
 * caller proceeds with its normal success UI (so local dev / previews don't
 * break). The request uses `no-cors` + text/plain because Apps Script Web
 * Apps don't return CORS headers — the row is still written; we just can't
 * read the response, so submission is best-effort/fire-and-forget.
 */

export type LeadSource = "Contact form" | "Assessment" | "Newsletter";

export interface LeadPayload {
  source: LeadSource;
  name?: string;
  email?: string;
  phone?: string;
  concern?: string;
  /** Preferred track (contact form). */
  track?: string;
  /** Chosen consultation slot, human-readable (e.g. "Wednesday, 17 June at 10:00 AM"). */
  slot?: string;
  message?: string;
  /** Assessment-only clinical context. */
  severity?: string;
  pain?: number | string;
  duration?: string;
  activity?: string;
  experience?: string;
  ageBand?: string;
  treatment?: string;
  imaging?: string;
  diet?: string;
  /** Program recommended by the assessment. */
  recommendedTrack?: string;
}

const ENDPOINT = process.env.NEXT_PUBLIC_LEADS_ENDPOINT;

export async function submitLead(payload: LeadPayload): Promise<boolean> {
  if (!ENDPOINT) {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn("[leads] NEXT_PUBLIC_LEADS_ENDPOINT not set — skipping send", payload);
    }
    return false;
  }

  try {
    const body = JSON.stringify({
      ...payload,
      page: typeof window !== "undefined" ? window.location.pathname : "",
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      submittedAt: new Date().toISOString(),
    });

    await fetch(ENDPOINT, {
      method: "POST",
      mode: "no-cors",
      // text/plain keeps it a "simple" request (no CORS preflight); the Apps
      // Script reads the raw body via e.postData.contents and JSON.parses it.
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body,
      redirect: "follow",
    });
    return true;
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.error("[leads] submission failed", err);
    }
    return false;
  }
}
