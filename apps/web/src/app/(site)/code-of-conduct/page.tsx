// Code of Conduct. This page deliberately does not restate the OWASP code — it
// is an authoritative document owned elsewhere, and paraphrasing it would
// create a second, subtly different version. What this page owns is the part
// contestants actually need in the moment: that the code applies, and how to
// report something.

//
// Platform copy throughout: the code applies to the event, not to a module's
// game. The one module-shaped clause is where the code REACHES — a
// secure-development event runs in a GitHub org, with pull requests and
// reviews in it, and an event without that module does not — so that clause is
// gated rather than left to name repositories nobody has.

import type { Metadata } from "next";
import Link from "next/link";
import PageHeader from "@/components/page-header";
import { isModuleEnabled } from "@/lib/modules";
import { event } from "@/lib/site";
import { eventConfig } from "@/lib/event-config";

const secureDev = isModuleEnabled("secure-development");

export const metadata: Metadata = {
  title: "Code of Conduct",
  description:
    `The codes of conduct that govern ${event.name}, and how to report a problem.`,
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
        description="The OWASP Code of Conduct applies to this event, and is in force the entire time you're here. Harassment of any kind ends your event."
      />

      <section className="rounded-lg border border-white/[0.06] bg-[#16162a] p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">Which code applies</h2>
        <ul className="flex flex-col gap-3">
          <li className="flex gap-3 text-sm leading-relaxed text-zinc-400">
            <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-[#2563eb]" />
            <span>
              The{" "}
              <ExternalLink href={event.owaspCodeOfConductUrl}>
                OWASP Code of Conduct
              </ExternalLink>{" "}
              governs this competition as an OWASP activity, and applies to the CTF Discord
              {secureDev ? (
                <>
                  , the {eventConfig.githubOrg} GitHub organization, and any pull requests or
                  reviews you take part in.
                </>
              ) : (
                <> and to every space this event runs in, on the day and online.</>
              )}
            </span>
          </li>
          <li className="flex gap-3 text-sm leading-relaxed text-zinc-400">
            <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-[#2563eb]" />
            <span>
              It is not waived by anything on this site, and organizers can remove anyone from
              the competition for a breach of it.
            </span>
          </li>
        </ul>
      </section>

      <section className="rounded-lg border border-white/[0.06] bg-[#16162a] p-6">
        <h2 className="mb-2 text-lg font-semibold text-white">Reporting a problem</h2>
        {/* "the target" here is the person a behaviour is aimed at, not a
            challenge target — a homonym, and this line is NOT rewritten to
            dodge the leak check. The rule on this work is to narrow the
            matching pattern, never to edit the copy (it is what got `target`
            restored as a bounded pattern rather than dropped), and this
            sentence renders on every event, secure-development ones
            included. See the `be the` lookbehind in
            `(site)/__tests__/secure-dev-terms.ts`. */}
        <p className="mb-4 text-sm leading-relaxed text-zinc-400">
          You do not need to be the target to report something, and you do not need proof. If
          something feels wrong, say so. Every route below reaches a real person.
        </p>
        <ul className="flex flex-col gap-3">
          <li className="flex gap-3 text-sm leading-relaxed text-zinc-400">
            <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-[#e53e3e]" />
            <span>
              <span className="font-semibold text-white">For anything CTF-specific</span>: find
              an organizer at the {event.name} area
              {event.discordUrl && (
                <>
                  , or message the organizers in the{" "}
                  <ExternalLink href={event.discordUrl}>CTF Discord</ExternalLink>
                </>
              )}
              . This is also the right route for scoring disputes and for reporting a bug in the
              competition or in the scoring pipeline.
            </span>
          </li>
          {event.contactEmail && (
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
          )}
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
