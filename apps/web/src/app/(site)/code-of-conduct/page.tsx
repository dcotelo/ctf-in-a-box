// Code of Conduct. This page deliberately does not restate the OWASP or DEF CON
// codes — both are authoritative documents owned elsewhere, and paraphrasing
// them would create a third, subtly different version. What this page owns is
// the part contestants actually need in the moment: which codes apply, and how
// to report something.

import type { Metadata } from "next";
import Link from "next/link";
import PageHeader from "@/components/page-header";
import { event } from "@/lib/site";

export const metadata: Metadata = {
  title: "Code of Conduct · OWASP CTF @ DEF CON 34",
  description:
    "The codes of conduct that govern the OWASP secure development CTF at DEF CON 34, and how to report a problem.",
};

const ExternalLink = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="ds-link"
  >
    {children}
  </a>
);

export default function CodeOfConductPage() {
  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        eyebrow="Conduct"
        title="Code of Conduct"
        description="Two codes apply to this event, and both are in force the entire time you're here. Harassment of any kind ends your event."
      />

      <section className="rounded-lg border border-white/[0.06] bg-[#16162a] p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">Which codes apply</h2>
        <ul className="flex flex-col gap-3">
          <li className="flex gap-3 text-sm leading-relaxed text-zinc-400">
            <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-[#2563eb]" />
            <span>
              The{" "}
              <ExternalLink href={event.defconCodeOfConductUrl}>
                DEF CON Code of Conduct
              </ExternalLink>{" "}
              governs the venue and everyone in it: attendees, speakers, press, volunteers,
              and Goons alike. DEF CON states it does not condone harassment against any
              participant, for any reason, and that harassment includes deliberate intimidation
              and targeting people in a way that makes them feel uncomfortable, unwelcome, or
              afraid.
            </span>
          </li>
          <li className="flex gap-3 text-sm leading-relaxed text-zinc-400">
            <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-[#2563eb]" />
            <span>
              The{" "}
              <ExternalLink href={event.owaspCodeOfConductUrl}>
                OWASP Code of Conduct
              </ExternalLink>{" "}
              governs this competition as an OWASP activity, and applies to the CTF Discord,
              the OWASP-CTF GitHub organization, and any pull requests or reviews you take part
              in.
            </span>
          </li>
          <li className="flex gap-3 text-sm leading-relaxed text-zinc-400">
            <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-[#2563eb]" />
            <span>
              Where the two overlap, follow the stricter one. Neither is waived by anything on
              this site, and organizers can remove anyone from the competition for a breach of
              either.
            </span>
          </li>
        </ul>
      </section>

      <section className="rounded-lg border border-white/[0.06] bg-[#16162a] p-6">
        <h2 className="mb-2 text-lg font-semibold text-white">Reporting a problem</h2>
        <p className="mb-4 text-sm leading-relaxed text-zinc-400">
          You do not need to be the target to report something, and you do not need proof. If
          something feels wrong, say so. Every route below reaches a real person.
        </p>
        <ul className="flex flex-col gap-3">
          <li className="flex gap-3 text-sm leading-relaxed text-zinc-400">
            <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-[#e53e3e]" />
            <span>
              <span className="font-semibold text-white">At the conference</span>: contact any
              Goon, the registration desk, or an info booth. DEF CON also runs a safety hotline
              you can call or text:{" "}
              <a
                href={`tel:+1${event.defconSafetyHotline.replace(/-/g, "")}`}
                className="font-mono ds-link"
              >
                {event.defconSafetyHotline}
              </a>
              .
            </span>
          </li>
          <li className="flex gap-3 text-sm leading-relaxed text-zinc-400">
            <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-[#e53e3e]" />
            <span>
              <span className="font-semibold text-white">Year-round, to DEF CON</span>:{" "}
              <a
                href={`mailto:${event.defconSafetyEmail}`}
                className="font-mono ds-link"
              >
                {event.defconSafetyEmail}
              </a>
              .
            </span>
          </li>
          <li className="flex gap-3 text-sm leading-relaxed text-zinc-400">
            <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-[#e53e3e]" />
            <span>
              <span className="font-semibold text-white">For anything CTF-specific</span>: find
              an organizer at the OWASP CTF area, or message the organizers in the{" "}
              <ExternalLink href={event.discordUrl}>CTF Discord</ExternalLink>. This is also the
              right route for scoring disputes and for reporting a bug in a challenge or the
              scorer.
            </span>
          </li>
          <li className="flex gap-3 text-sm leading-relaxed text-zinc-400">
            <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-[#e53e3e]" />
            <span>
              <span className="font-semibold text-white">In writing, and in private</span>:{" "}
              <a href={`mailto:${event.contactEmail}`} className="font-mono ds-link">
                {event.contactEmail}
              </a>
              . This reaches the CTF organizers directly. Use it if the report involves someone
              you would rather not approach in person, or if you want a written record instead
              of a conversation in a shared Discord.
            </span>
          </li>
        </ul>
      </section>

      <section className="rounded-lg border border-white/[0.06] bg-[#16162a] p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">Also worth reading</h2>
        <ul className="flex flex-col gap-3">
          <li className="flex gap-3 text-sm leading-relaxed text-zinc-400">
            <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-[#2563eb]" />
            <span>
              <Link href="/rules" className="ds-link">
                Rules
              </Link>
              : teams, fair play, scope, and how scoring works.
            </span>
          </li>
          <li className="flex gap-3 text-sm leading-relaxed text-zinc-400">
            <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-[#2563eb]" />
            <span>
              <Link href="/terms" className="ds-link">
                Terms
              </Link>{" "}
              and{" "}
              <Link href="/privacy" className="ds-link">
                Privacy
              </Link>
              : what taking part commits you to, and what this site stores about you.
            </span>
          </li>
        </ul>
      </section>
    </div>
  );
}
