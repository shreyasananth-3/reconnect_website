import type { Metadata } from "next";
import Reveal from "@/components/Reveal";
import Eyebrow from "@/components/Eyebrow";
import { SkeletonSvg } from "@/components/AnatomicalArt";
import ContactForm from "./_components/ContactForm";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Get in touch with our team. Book a consultation, ask about a program, or message us — someone from the team will get in touch.",
};

type Way = {
  label: string;
  actionLabel: string;
  href: string;
  primary?: boolean;
};

const ways: Way[] = [
  {
    label: "Book a consultation",
    actionLabel: "Open booking →",
    href: "#contact-form",
    primary: true,
  },
  {
    label: "Email",
    actionLabel: "drshruthi@reconnect.health",
    href: "mailto:drshruthi@reconnect.health",
  },
  {
    label: "WhatsApp / phone",
    actionLabel: "+91 80889 11265",
    href: "tel:+918088911265",
  },
  {
    label: "Instagram",
    actionLabel: "@reconnectwellness",
    href: "https://instagram.com",
  },
  {
    label: "LinkedIn",
    actionLabel: "Reconnect Wellness",
    href: "https://linkedin.com",
  },
];



export default function ContactPage() {
  return (
    <>
      {/* ═══════════════════════════════════════════════════════
          INTRO
          ═══════════════════════════════════════════════════════ */}
      <section className="relative overflow-hidden bg-bone pt-32 md:pt-40 pb-12 md:pb-16">
        <SkeletonSvg className="watermark text-ink right-[-120px] top-[40px] w-[480px] hidden md:block" />

        <div className="container-site relative">
          <div className="max-w-3xl">
            <Reveal>
              <Eyebrow>Contact</Eyebrow>
            </Reveal>
            <Reveal delay={0.1}>
              <h1 className="text-hero text-ink mt-6">
                Talk to the{" "}
                <span className="serif-italic text-clay">team.</span>
              </h1>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════
          SPLIT: ways to reach us · form
          ═══════════════════════════════════════════════════════ */}
      <section className="bg-bone pb-32 md:pb-40">
        <div className="container-site">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16 items-start">
            {/* ── LEFT: warm copy + contact methods + reassurance ── */}
            <div className="lg:col-span-5 lg:sticky lg:top-32">
              <Reveal>
                <h2 className="text-h2 font-display text-ink">
                  Five ways to reach&nbsp;us.
                </h2>
                <p className="text-body text-ink-soft mt-4 max-w-md">
                  Pick whichever fits the moment. The form on the right is the easiest if
                  you&rsquo;ve got a few minutes to share context.
                </p>
              </Reveal>

              <div className="mt-10 flex flex-col">
                {ways.map((w, i) => (
                  <a
                    key={w.label}
                    href={w.href}
                    target={w.href.startsWith("http") ? "_blank" : undefined}
                    rel={w.href.startsWith("http") ? "noopener noreferrer" : undefined}
                    className={`group flex items-center justify-between gap-6 py-5 ${
                      i !== ways.length - 1 ? "border-b border-line" : ""
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className={`text-eyebrow ${w.primary ? "text-clay" : "text-ink-soft"}`}>
                        {w.label}
                      </p>
                    </div>
                    <span className="text-body-sm font-medium text-clay shrink-0 opacity-70 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap">
                      {w.actionLabel}
                    </span>
                  </a>
                ))}
              </div>
            </div>

            {/* ── RIGHT: form ────────────────────────────────────── */}
            <div className="lg:col-span-7" id="contact-form">
              <Reveal delay={0.1}>
                <ContactForm />
              </Reveal>
            </div>
          </div>
        </div>
      </section>

    </>
  );
}
