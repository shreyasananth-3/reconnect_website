'use client';

/*
 * Booking flow: form → booking (real slot picker) → payment (real hold).
 *
 * `submit` captures the lead (best-effort, via submitLead) and advances to slot
 * selection. The actual booking — a real, public, no-auth POST to the Reconnect
 * backend (lib/booking.ts) — fires on "Confirm booking" once a slot is chosen,
 * because the endpoint needs a slotId. A successful book returns a 30-MINUTE
 * HOLD (pendingBookingId + holdExpiresAt); staff confirm the PhonePe payment
 * manually later. The site shows the QR + a pay-by countdown and does NOT poll.
 *
 * Still TODO (not blocking, intentionally out of scope here):
 *   • CAPTCHA / Turnstile on the public form.
 *   • Replace the static UPI QR with a real per-booking payment intent.
 */

import Image from 'next/image';
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type FormEvent,
} from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import Button from '@/components/Button';
import { submitLead } from '@/lib/leads';
import {
	getSlots,
	bookAppointment,
	type Slot,
	type BookResult,
	type BookingError,
} from '@/lib/booking';

type Form = {
	name: string;
	email: string;
	phone: string;
	concern: string;
	track: string;
	message: string;
};

/** Post-submit flow: collect details → pick a real slot → see the hold + pay. */
type Step = 'form' | 'booking' | 'payment';

/* Tighter than the form's old check: require a real-looking domain with a 2+
   char TLD (no trailing dot, no test-only single-label hosts). The backend
   rejects test TLDs, so we fail fast client-side to avoid a 400 round-trip. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;

/** Loading lifecycle for the slots fetch on the booking step. */
type SlotsState =
	| { status: 'loading' }
	| { status: 'error'; message: string }
	| { status: 'empty' }
	| { status: 'loaded'; slots: Slot[] };

const initial: Form = {
	name: '',
	email: '',
	phone: '',
	concern: '',
	track: '',
	message: '',
};

const CONCERNS = [
	{ v: 'knee', l: 'Knee pain' },
	{ v: 'back-neck', l: 'Back or neck pain' },
	{ v: 'arthritis', l: 'Arthritis' },
	{ v: 'disc', l: 'Disc issues' },
	{ v: 'bone-health', l: 'Bone health (osteoporosis)' },
	{ v: 'prevention', l: 'Prevention / staying ahead' },
	{ v: 'other', l: 'Something else' },
];

const TRACKS = [
	{ v: 'unsure', l: "I'm not sure yet" },
	{ v: 'prevent', l: 'Prevent' },
	{ v: 'manage', l: 'Manage' },
	{ v: 'strengthen', l: 'Strengthen' },
];

const MONTHS = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December',
];
const DAYS_FULL = [
	'Sunday',
	'Monday',
	'Tuesday',
	'Wednesday',
	'Thursday',
	'Friday',
	'Saturday',
];
const DAYS_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_ABBR = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec',
];

/** Parse an API "YYYY-MM-DD" as a LOCAL date (no UTC shift from `new Date(str)`). */
function parseSlotDate(ymd: string): Date {
	const [y, m, d] = ymd.split('-').map(Number);
	return new Date(y, (m || 1) - 1, d || 1);
}

/** "Monday, 23 June" from an API slot_date. */
function formatSlotDate(ymd: string): string {
	const d = parseSlotDate(ymd);
	return `${DAYS_FULL[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** Compact parts for a day chip: { weekday: "Wed", day: "17 Jun" }. */
function dayChipParts(ymd: string): { weekday: string; day: string } {
	const d = parseSlotDate(ymd);
	return {
		weekday: DAYS_ABBR[d.getDay()],
		day: `${d.getDate()} ${MONTHS_ABBR[d.getMonth()]}`,
	};
}

/** "10:00 AM" from an API "HH:MM:SS". */
function formatSlotTime(hms: string): string {
	const [hStr, mStr] = hms.split(':');
	let h = Number(hStr);
	const m = mStr ?? '00';
	const ampm = h >= 12 ? 'PM' : 'AM';
	h = h % 12 || 12;
	return `${h}:${m} ${ampm}`;
}

/** "Monday, 23 June at 10:00 AM" — used in the payment confirmation copy. */
function formatSlot(s: Slot): string {
	return `${formatSlotDate(s.slot_date)} at ${formatSlotTime(s.slot_time)}`;
}

function firstNameOf(full: string): string {
	return full.trim().split(/\s+/)[0] || 'friend';
}

export default function ContactForm() {
	const [form, setForm] = useState<Form>(initial);
	const [error, setError] = useState('');
	const [step, setStep] = useState<Step>('form');
	// Real slot selection (replaces the old free-text date).
	const [slotsState, setSlotsState] = useState<SlotsState>({
		status: 'loading',
	});
	const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
	// Booking call (fires on "Confirm booking").
	const [booking, setBooking] = useState(false);
	const [bookingError, setBookingError] = useState('');
	const [hold, setHold] = useState<BookResult | null>(null);
	// "I've paid" acknowledgement on the payment step (staff verify manually).
	const [paymentClaimed, setPaymentClaimed] = useState(false);
	const prefersReduced = useReducedMotion();
	const cardRef = useRef<HTMLDivElement>(null);

	// Fetch Dr Shruthi's free slots when entering the booking step. Re-runnable
	// (e.g. after a 409 race) via loadSlots().
	const loadSlots = useCallback(async () => {
		setSlotsState({ status: 'loading' });
		try {
			const slots = await getSlots();
			setSlotsState(
				slots.length ? { status: 'loaded', slots } : { status: 'empty' },
			);
		} catch (err) {
			// The slots endpoint shares the booking rate limit (10/15min/IP), so a
			// user who retries a lot can get 429 here, not just on /book.
			const message =
				(err as BookingError)?.status === 429 ?
					"You've tried a few times in a row — please wait a minute, then refresh."
				:	"Couldn't load available times. Please try again.";
			setSlotsState({ status: 'error', message });
		}
	}, []);

	// On each step change after submit, bring the card into view (offset for the
	// sticky nav via scroll-mt on the card itself).
	useEffect(() => {
		if (step !== 'form' && cardRef.current) {
			cardRef.current.scrollIntoView({
				behavior: prefersReduced ? 'auto' : 'smooth',
				block: 'start',
			});
		}
	}, [step, prefersReduced]);

	const update = <K extends keyof Form>(k: K, v: Form[K]) => {
		setForm((f) => ({ ...f, [k]: v }));
		setError('');
	};

	const submit = (e: FormEvent) => {
		e.preventDefault();
		if (!form.name.trim()) return setError('Tell us your name.');
		// Email OR phone is required (mirrors the booking API's .or()). Validate the
		// email only if one was given; a phone alone is enough to proceed.
		const hasEmail = !!form.email.trim();
		const hasPhone = !!form.phone.trim();
		if (!hasEmail && !hasPhone)
			return setError('Add an email or a phone number so we can reach you.');
		if (hasEmail && !EMAIL_RE.test(form.email.trim()))
			return setError('Please enter a valid email address.');
		// `message` is now optional — booking is the primary action; don't block it.

		// Send to the leads spreadsheet (best-effort) with human-readable labels.
		// This is marketing capture only and is independent of the booking call.
		const concernLabel =
			CONCERNS.find((c) => c.v === form.concern)?.l ?? form.concern;
		const trackLabel = TRACKS.find((t) => t.v === form.track)?.l ?? form.track;
		void submitLead({
			source: 'Contact form',
			name: form.name,
			email: form.email,
			phone: form.phone,
			concern: concernLabel,
			track: trackLabel,
			message: form.message,
		});
		// Kick off the slots fetch from the user action (not an effect) and advance.
		void loadSlots();
		setStep('booking');
	};

	// Fire the real, public booking. The slot determines the doctor server-side,
	// so we send only the slotId (no doctorId). On success we hold a 30-min slot
	// and advance to payment; errors are mapped to friendly copy without losing
	// the user's place on the booking step.
	const confirmBooking = async () => {
		if (!selectedSlot || booking) return;
		setBooking(true);
		setBookingError('');
		const [firstName, ...rest] = form.name.trim().split(/\s+/);
		const concernLabel =
			CONCERNS.find((c) => c.v === form.concern)?.l ?? form.concern;
		try {
			const result = await bookAppointment({
				firstName: firstName || form.name.trim(),
				lastName: rest.length ? rest.join(' ') : undefined,
				email: form.email.trim() || undefined,
				phone: form.phone.trim() || undefined,
				slotId: selectedSlot.id,
				concernArea: concernLabel || undefined,
			});
			setHold(result);
			setStep('payment');
		} catch (err) {
			const status = (err as BookingError)?.status;
			if (status === 409) {
				// Ambiguous by design (no PII): slot just taken OR contact already a
				// member. Refresh slots so they can pick another, and offer the login path.
				setBookingError(
					'That slot may have just been taken, or this contact already has an account. ' +
						"We've refreshed the times below — please pick another, or log in / contact us if you already have an account.",
				);
				setSelectedSlot(null);
				void loadSlots();
			} else if (status === 429) {
				setBookingError(
					'Too many attempts just now. Please try again in a few minutes.',
				);
			} else if (status === 400) {
				setBookingError(
					(err as BookingError)?.message ||
						'Please check your details and try again.',
				);
			} else {
				// Network / CORS / config: fail closed, keep the lead we already captured.
				setBookingError(
					"We couldn't reach booking just now. Please try again, or contact us to book.",
				);
			}
		} finally {
			setBooking(false);
		}
	};

	// "I've paid" — the public site can't confirm payment (staff do that), so we
	// just acknowledge and drop a best-effort note to the leads sheet so staff
	// know to verify this booking's payment.
	const claimPayment = () => {
		if (paymentClaimed) return;
		setPaymentClaimed(true);
		void submitLead({
			source: 'Contact form',
			name: form.name,
			email: form.email,
			phone: form.phone,
			message: hold
				? `PAYMENT CLAIMED for booking #${hold.pendingBookingId} — please verify the ₹500 payment.`
				: 'PAYMENT CLAIMED — please verify the ₹500 payment.',
		});
	};

	const reset = () => {
		setForm(initial);
		setSelectedSlot(null);
		setSlotsState({ status: 'loading' });
		setHold(null);
		setBookingError('');
		setPaymentClaimed(false);
		setError('');
		setStep('form');
	};

	const first = firstNameOf(form.name);

	return (
		<div
			ref={cardRef}
			className='relative scroll-mt-28 bg-calcium rounded-[24px] p-6 sm:p-10 hairline shadow-card'
		>
			<AnimatePresence mode='wait'>
				{/* ── STEP: Thank you + pick a consultation date ──────────── */}
				{step === 'booking' && (
					<motion.div
						key='booking'
						initial={prefersReduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
						animate={prefersReduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
						exit={{ opacity: 0 }}
						transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
						className='text-center py-6 md:py-10'
					>
						<SuccessBadge />
						<p className='text-eyebrow text-clay'>Message received</p>
						<h3 className='text-h2 font-display text-ink mt-4'>
							Thank you, {first}.
						</h3>
						<p className='text-body-lg text-ink-soft mt-5 max-w-md mx-auto'>
							One last step — pick a time for your consultation.
						</p>

						<SlotPicker
							state={slotsState}
							selected={selectedSlot}
							onSelect={(s) => {
								setSelectedSlot(s);
								setBookingError('');
							}}
							onRetry={loadSlots}
						/>

						<AnimatePresence>
							{bookingError && (
								<motion.p
									initial={{ opacity: 0, y: -4 }}
									animate={{ opacity: 1, y: 0 }}
									exit={{ opacity: 0 }}
									role='alert'
									className='mx-auto mt-6 max-w-md text-body-sm text-clay-dark bg-clay-soft/60 rounded-[14px] px-4 py-3'
								>
									{bookingError}
								</motion.p>
							)}
						</AnimatePresence>

						<button
							type='button'
							disabled={!selectedSlot || booking}
							onClick={confirmBooking}
							className={`mx-auto mt-6 block w-full max-w-[340px] rounded-pill px-7 py-4 font-medium text-calcium bg-clay transition-opacity ${
								selectedSlot && !booking ? 'opacity-100' : (
									'opacity-40 pointer-events-none'
								)
							}`}
						>
							{booking ? 'Booking…' : 'Confirm booking →'}
						</button>

						<div className='mt-6'>
							<button
								onClick={reset}
								className='text-body-sm text-ink-soft hover:text-ink underline-offset-4 hover:underline px-4 py-2'
							>
								Send another message
							</button>
						</div>
					</motion.div>
				)}

				{/* ── STEP: Payment ───────────────────────────────────────── */}
				{step === 'payment' && (
					<motion.div
						key='payment'
						initial={prefersReduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
						animate={prefersReduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
						exit={{ opacity: 0 }}
						transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
						className='text-center py-6 md:py-10'
					>
						<SuccessBadge />
						<p className='text-eyebrow text-clay'>Final step</p>
						<h3 className='text-h2 font-display text-ink mt-4'>
							Almost there, {first}.
						</h3>
						<p className='text-body-lg text-ink-soft mt-5 max-w-md mx-auto'>
							We&rsquo;re holding your consultation
							{selectedSlot ?
								<>
									{' '}
									for{' '}
									<span className='text-ink font-medium'>
										{formatSlot(selectedSlot)}
									</span>
								</>
							:	null}
							. Complete your payment of{' '}
							<span className='text-ink font-medium'>₹500</span> to confirm it.
							<span className='block mt-2 text-body text-ink font-semibold italic'>
								The consultation amount will be adjusted when you join the
								program.
							</span>
						</p>

						{hold && <HoldCountdown expiresAt={hold.holdExpiresAt} />}

						{/* Reconnect-branded UPI QR (brand name + scan label baked into the
                artwork — no personal name). */}
						<div className='mt-8 flex flex-col items-center gap-4'>
							<Image
								src='/qr-reconnect.png'
								alt='Reconnect UPI QR code — scan to pay with any UPI app'
								width={270}
								height={279}
								className='rounded-[16px]'
							/>
							<p className='text-body-sm text-ink-soft max-w-sm'>
								Once we receive your payment, we&rsquo;ll send you a
								confirmation on WhatsApp.
							</p>
						</div>

						{/* Payment acknowledgement — the site can't verify payment (staff
						    do), so this just confirms the user has paid and signals staff. */}
						{paymentClaimed ?
							<div className='mx-auto mt-8 max-w-sm rounded-[16px] bg-clay-soft/50 px-5 py-4'>
								<p className='text-body-sm text-ink'>
									Thank you, {first} — we&rsquo;ve noted your payment. Our team
									will verify it and confirm your consultation on WhatsApp.
								</p>
							</div>
						:	<button
								type='button'
								onClick={claimPayment}
								className='mx-auto mt-8 block w-full max-w-[340px] rounded-pill px-7 py-4 font-medium text-calcium bg-clay transition-opacity hover:opacity-90'
							>
								I&rsquo;ve completed the payment →
							</button>
						}

						<div className='mt-8 flex flex-wrap items-center justify-center gap-x-2 gap-y-3'>
							<button
								onClick={() => setStep('booking')}
								className='text-body-sm text-ink-soft hover:text-ink underline-offset-4 hover:underline px-4 py-2'
							>
								← Change time
							</button>
							<button
								onClick={reset}
								className='text-body-sm text-ink-soft hover:text-ink underline-offset-4 hover:underline px-4 py-2'
							>
								Send another message
							</button>
						</div>
					</motion.div>
				)}

				{/* ── STEP: Contact form ──────────────────────────────────── */}
				{step === 'form' && (
					<motion.form
						key='form'
						onSubmit={submit}
						initial={prefersReduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0 }}
						transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
						className='flex flex-col gap-5'
					>
						{/* <p className="text-eyebrow text-clay">Send a message</p> */}

						<div className='grid grid-cols-1 sm:grid-cols-2 gap-5'>
							<Field
								label='Your name'
								value={form.name}
								onChange={(v) => update('name', v)}
								placeholder='Full name'
								autoComplete='name'
								required
							/>
							<Field
								label='Email'
								type='email'
								value={form.email}
								onChange={(v) => update('email', v)}
								placeholder='you@example.com'
								autoComplete='email'
							/>
						</div>

						{/* Email OR phone is required — validated in submit(), so neither input
                carries the HTML `required` attribute (it would block the other path). */}
						<Field
							label='Phone'
							type='tel'
							value={form.phone}
							onChange={(v) => update('phone', v)}
							placeholder='Your phone number'
							autoComplete='tel'
							inputMode='tel'
						/>

						<div className='grid grid-cols-1 sm:grid-cols-2 gap-5'>
							<Select
								label='Primary concern'
								value={form.concern}
								onChange={(v) => update('concern', v)}
								options={CONCERNS}
								placeholder="What's going on?"
							/>
							<Select
								label='Preferred track'
								value={form.track}
								onChange={(v) => update('track', v)}
								options={TRACKS}
								placeholder='Not sure? Pick that.'
							/>
						</div>

						<label className='flex flex-col gap-2'>
							<span className='text-eyebrow text-ink-soft'>Your message</span>
							<textarea
								value={form.message}
								onChange={(e) => update('message', e.target.value)}
								rows={5}
								placeholder="A short note — your situation, your questions, what you'd like to know."
								className='rounded-[14px] bg-bone-deep/40 border border-line text-body text-ink p-4 outline-none focus:border-clay transition-colors duration-200'
							/>
						</label>

						<AnimatePresence>
							{error && (
								<motion.p
									initial={{ opacity: 0, y: -4 }}
									animate={{ opacity: 1, y: 0 }}
									exit={{ opacity: 0 }}
									role='alert'
									className='text-body-sm text-clay-dark bg-clay-soft/60 rounded-pill px-4 py-2 self-start'
								>
									{error}
								</motion.p>
							)}
						</AnimatePresence>

						<div className='flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-2'>
							<p className='text-caption text-ink-soft max-w-xs'>
								Your message is reviewed only by our clinical team. Full privacy
								copy TODO.
							</p>
							<Button variant='clay' size='lg' type='submit' arrow>
								Next
							</Button>
						</div>
					</motion.form>
				)}
			</AnimatePresence>
		</div>
	);
}

/* ── Consultation slot picker ──────────────────────────────────
   Real slots from GET /public/appointment/slots. Dates are a horizontal,
   scroll/click day strip; only the active day's times render below it.
   Selecting a time holds a `Slot` (its `id` is the booking slotId). Renders
   loading / error / empty / loaded states. Mounts only after submit. */

function SlotPicker({
	state,
	selected,
	onSelect,
	onRetry,
}: {
	state: SlotsState;
	selected: Slot | null;
	onSelect: (s: Slot) => void;
	onRetry: () => void;
}) {
	// Group loaded slots by date, preserving the backend's order.
	const byDate = useMemo(() => {
		if (state.status !== 'loaded') return [];
		const groups = new Map<string, Slot[]>();
		for (const s of state.slots) {
			const arr = groups.get(s.slot_date) ?? [];
			arr.push(s);
			groups.set(s.slot_date, arr);
		}
		return Array.from(groups, ([date, slots]) => ({ date, slots }));
	}, [state]);

	const dates = useMemo(() => byDate.map((g) => g.date), [byDate]);

	// The active day is fully DERIVED (no effect): an explicit chip click wins;
	// otherwise follow the selected slot's day; otherwise default to the first
	// available day. Resolving against `dates` every render means a 409-refresh
	// that drops the active day can't leave us pointing at a date that's gone.
	const [clickedDate, setClickedDate] = useState<string | null>(null);
	const activeDate =
		(clickedDate && dates.includes(clickedDate) && clickedDate) ||
		(selected && dates.includes(selected.slot_date) && selected.slot_date) ||
		dates[0] ||
		null;

	const activeSlots = byDate.find((g) => g.date === activeDate)?.slots ?? [];

	if (state.status === 'loading') {
		return (
			<div className='mx-auto mt-8 w-full max-w-md rounded-[16px] border border-line bg-white p-6 text-center'>
				<p className='text-body-sm text-ink-soft'>Loading available times…</p>
			</div>
		);
	}

	if (state.status === 'error') {
		return (
			<div className='mx-auto mt-8 w-full max-w-md rounded-[16px] border border-line bg-white p-6 text-center'>
				<p className='text-body-sm text-ink-soft'>{state.message}</p>
				<button
					type='button'
					onClick={onRetry}
					className='mt-3 text-body-sm text-clay underline-offset-4 hover:underline'
				>
					Try again
				</button>
			</div>
		);
	}

	if (state.status === 'empty') {
		return (
			<div className='mx-auto mt-8 w-full max-w-md rounded-[16px] border border-line bg-white p-6 text-center'>
				<p className='text-body-sm text-ink-soft'>
					No consultation times are open right now. Please check back soon, or
					send us a message and we&rsquo;ll arrange one.
				</p>
				<button
					type='button'
					onClick={onRetry}
					className='mt-3 text-body-sm text-clay underline-offset-4 hover:underline'
				>
					Refresh times
				</button>
			</div>
		);
	}

	return (
		<div className='mx-auto mt-8 w-full max-w-md rounded-[16px] border border-line bg-white p-5 text-left'>
			{/* Horizontal day strip — scroll sideways or click to switch days.
          Scrollbar is ALWAYS visible (not hover-only): a thin track with a
          clearly-present-but-quiet thumb, so the "more days" affordance reads at
          rest. Firefox via scrollbar-*; Chrome/Safari via ::-webkit-scrollbar.
          We force the webkit bar to render even on macOS overlay-scrollbar
          setups by sizing the track + thumb explicitly. */}
			<div
				className='-mx-1 flex gap-2 overflow-x-auto px-1 pb-2 [scrollbar-width:thin] [scrollbar-color:var(--color-ink-soft)_var(--color-bone-deep)] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar]:block [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-bone-deep/50 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-ink-soft/30 hover:[&::-webkit-scrollbar-thumb]:bg-ink-soft/50'
				role='tablist'
				aria-label='Choose a day'
			>
				{byDate.map(({ date, slots }) => {
					const { weekday, day } = dayChipParts(date);
					const isActive = date === activeDate;
					let cls =
						'shrink-0 rounded-[14px] border px-4 py-2 text-center transition-colors ';
					cls +=
						isActive ?
							'border-clay bg-clay/5 text-ink'
						:	'border-line text-ink-soft hover:border-clay/60 hover:text-ink';
					return (
						<button
							type='button'
							key={date}
							role='tab'
							aria-selected={isActive}
							onClick={() => setClickedDate(date)}
							className={cls}
						>
							<span className='block text-[11px] uppercase tracking-wide'>
								{weekday}
							</span>
							<span className='block text-body-sm font-medium whitespace-nowrap'>
								{day}
							</span>
							<span className='mt-0.5 block text-[10px] text-ink-soft'>
								{slots.length} {slots.length === 1 ? 'slot' : 'slots'}
							</span>
						</button>
					);
				})}
			</div>

			{/* Times for the active day only. */}
			{activeDate && (
				<div className='mt-4'>
					<p className='mb-3 text-body-sm font-medium text-ink'>
						{formatSlotDate(activeDate)}
					</p>
					<div className='flex flex-wrap gap-2'>
						{activeSlots.map((s) => {
							const isSelected = selected?.id === s.id;
							let cls =
								'rounded-pill border px-4 py-2 text-body-sm transition-colors ';
							cls +=
								isSelected ?
									'border-clay bg-clay text-calcium font-medium'
								:	'border-line text-ink hover:border-clay hover:bg-clay/5';
							return (
								<button
									type='button'
									key={s.id}
									aria-pressed={isSelected}
									onClick={() => onSelect(s)}
									className={cls}
								>
									{formatSlotTime(s.slot_time)}
								</button>
							);
						})}
					</div>
				</div>
			)}
		</div>
	);
}

/* ── Hold countdown ────────────────────────────────────────────
   Counts down to holdExpiresAt (the 30-min slot hold). Display only — the site
   never confirms or polls payment; staff do that manually. */

function HoldCountdown({ expiresAt }: { expiresAt: string }) {
	// The backend sends "YYYY-MM-DD HH:MM:SS" (space-separated, no zone). Safari
	// returns Invalid Date for that form, so normalize the space to "T" before
	// parsing. (If it's already ISO, the replace is a no-op.)
	const target = useMemo(
		() => new Date(expiresAt.replace(' ', 'T')).getTime(),
		[expiresAt],
	);
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(id);
	}, []);

	// Guard against an unparseable timestamp — just don't render a countdown.
	if (Number.isNaN(target)) return null;

	const msLeft = Math.max(0, target - now);
	const mins = Math.floor(msLeft / 60000);
	const secs = Math.floor((msLeft % 60000) / 1000);
	const expired = msLeft === 0;

	return (
		<p
			className='mt-6 text-body-sm text-clay-dark'
			role='status'
			aria-live='polite'
		>
			{expired ?
				<>
					This hold has expired — please send another message to pick a new
					time.
				</>
			:	<>
					We&rsquo;re holding this slot for{' '}
					<span className='font-medium tabular-nums'>
						{mins}:{secs.toString().padStart(2, '0')}
					</span>
					. Please complete payment before it lapses.
				</>
			}
		</p>
	);
}

/* ── Shared bits ───────────────────────────────────────────── */

function SuccessBadge() {
	return (
		<div className='inline-flex items-center justify-center w-16 h-16 rounded-full bg-clay-soft text-clay-dark mb-6'>
			<svg
				width='28'
				height='28'
				viewBox='0 0 20 20'
				fill='none'
				stroke='currentColor'
				strokeWidth='1.75'
				strokeLinecap='round'
				strokeLinejoin='round'
				aria-hidden='true'
			>
				<path d='M4 10l4 4 8-8' />
			</svg>
		</div>
	);
}

/* ── Field primitives ──────────────────────────────────────── */

function Field({
	label,
	value,
	onChange,
	type = 'text',
	placeholder,
	autoComplete,
	required,
	inputMode,
}: {
	label: string;
	value: string;
	onChange: (v: string) => void;
	type?: string;
	placeholder?: string;
	autoComplete?: string;
	required?: boolean;
	inputMode?: 'text' | 'tel' | 'email' | 'numeric';
}) {
	return (
		<label className='flex flex-col gap-2'>
			<span className='text-eyebrow text-ink-soft'>{label}</span>
			<input
				type={type}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				autoComplete={autoComplete}
				required={required}
				aria-required={required}
				inputMode={inputMode}
				className='rounded-[14px] bg-bone-deep/40 border border-line text-body text-ink p-4 outline-none focus:border-clay transition-colors duration-200'
			/>
		</label>
	);
}

function Select({
	label,
	value,
	onChange,
	options,
	placeholder,
}: {
	label: string;
	value: string;
	onChange: (v: string) => void;
	options: { v: string; l: string }[];
	placeholder?: string;
}) {
	return (
		<label className='flex flex-col gap-2'>
			<span className='text-eyebrow text-ink-soft'>{label}</span>
			<div className='relative'>
				<select
					value={value}
					onChange={(e) => onChange(e.target.value)}
					className='appearance-none w-full rounded-[14px] bg-bone-deep/40 border border-line text-body text-ink p-4 pr-10 outline-none focus:border-clay transition-colors duration-200'
				>
					<option value='' disabled>
						{placeholder ?? 'Choose…'}
					</option>
					{options.map((o) => (
						<option key={o.v} value={o.v}>
							{o.l}
						</option>
					))}
				</select>
				<svg
					aria-hidden='true'
					className='absolute right-4 top-1/2 -translate-y-1/2 text-ink-soft pointer-events-none'
					width='16'
					height='16'
					viewBox='0 0 20 20'
					fill='none'
					stroke='currentColor'
					strokeWidth='1.5'
					strokeLinecap='round'
					strokeLinejoin='round'
				>
					<path d='M5 8l5 5 5-5' />
				</svg>
			</div>
		</label>
	);
}
