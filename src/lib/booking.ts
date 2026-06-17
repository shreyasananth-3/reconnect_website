/**
 * Public booking → Reconnect backend (no auth, cross-origin).
 *
 * This is the PUBLIC, non-member booking flow only. Two calls, both public:
 *   1. getSlots()        GET  /v1/api/public/appointment/slots   — Dr Shruthi's
 *                        free slots for the next ~15 days (no params, no auth).
 *   2. bookAppointment() POST /v1/api/public/appointment/book     — hold a slot
 *                        for a non-member; returns a 30-min hold (not a
 *                        confirmed appointment — staff confirm payment later).
 *
 * Unlike lib/leads.ts (which is `no-cors` fire-and-forget to Apps Script), these
 * are REAL cross-origin requests: we must read the response, so NO `no-cors`, NO
 * Authorization header, NO credentials. The endpoint is public by design.
 *
 * The backend origin is `NEXT_PUBLIC_API_BASE`, set per environment at build
 * time (e.g. https://api.reconnect.health). Public value — fine, the endpoint is
 * public. PROD note: the website origin must be in the backend CORS allowlist
 * (PROD_ORIGINS) or the browser blocks these requests.
 */

const API = process.env.NEXT_PUBLIC_API_BASE;

/** A free, future consultation slot from the public slots endpoint. */
export interface Slot {
  /** The slotId to pass to bookAppointment. */
  id: number;
  doctor_name: string;
  /** "YYYY-MM-DD" */
  slot_date: string;
  /** "HH:MM:SS" */
  slot_time: string;
  /** "Morning" | "Evening" (free text from the backend). */
  slot_period: string;
}

/** The fields the booking endpoint accepts — a SUBSET of the contact form. */
export interface BookInput {
  firstName: string;
  lastName?: string;
  /** email OR phone required; email must be a real TLD. */
  email?: string;
  phone?: string;
  /** A slot id from getSlots(). The slot determines the doctor server-side. */
  slotId: number;
  /** Free text, max 100. */
  concernArea?: string;
}

/** The 30-minute hold created by a successful booking. */
export interface BookResult {
  pendingBookingId: number;
  /** ISO timestamp when the hold lapses and the slot auto-releases. */
  holdExpiresAt: string;
}

/** An Error carrying the HTTP status so callers can branch on 409/400/429. */
export interface BookingError extends Error {
  status?: number;
}

function missingApiBase(): BookingError {
  const err: BookingError = Object.assign(
    new Error("Booking is not configured. Please contact us to book."),
    { status: 0 },
  );
  return err;
}

/**
 * List Dr Shruthi's free future slots. Returns `[]` when availability hasn't
 * been seeded yet — that's a "no slots" UI state, not an error.
 */
export async function getSlots(): Promise<Slot[]> {
  if (!API) throw missingApiBase();

  const res = await fetch(`${API}/v1/api/public/appointment/slots`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  const json = await res.json();
  if (!res.ok) {
    throw Object.assign(new Error(json?.message || "Could not load slots"), {
      status: res.status,
    }) as BookingError;
  }
  // Envelope: { status, status_code, message, data: Slot[] }
  return (json?.data ?? []) as Slot[];
}

/**
 * Hold a slot for a non-member. Send ONLY the fields in BookInput — unknown keys
 * are rejected with 400. Throws a BookingError (with `.status`) on any non-2xx:
 *   400 bad input · 409 member-exists-or-slot-taken (no PII) · 429 rate limit.
 */
export async function bookAppointment(input: BookInput): Promise<BookResult> {
  if (!API) throw missingApiBase();

  const res = await fetch(`${API}/v1/api/public/appointment/book`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }, // NO Authorization, NO credentials
    body: JSON.stringify(input), // send ONLY BookInput fields — unknown keys → 400
  });
  const json = await res.json();
  if (!res.ok) {
    // json = { status:'error', status_code, message }
    throw Object.assign(new Error(json?.message || "Booking failed"), {
      status: res.status,
    }) as BookingError;
  }
  return json.data as BookResult; // { pendingBookingId, holdExpiresAt }
}
