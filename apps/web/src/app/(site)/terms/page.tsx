// Participation terms for the CTF specifically. This is not a general site
// Terms of Service — OWASP publishes no ToS, and its General Disclaimer is the
// governing document, linked below. What's here is limited to what taking part
// in this competition actually commits you to.

import type { Metadata } from "next";
import Link from "next/link";
import PageHeader from "@/components/page-header";
import { enabledApps, joinAppNames } from "@/lib/apps";
import { event } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms",
  description:
    `Participation terms for the ${event.name} secure development CTF: eligibility, testing scope, submissions, scoring, and prizes.`,
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

const appList = joinAppNames(enabledApps.map((a) => a.name));

const sections: { heading: string; items: React.ReactNode[] }[] = [
  {
    heading: "Eligibility",
    items: [
      "You need a GitHub account. Your GitHub login is your identity for scoring, so open every pull request from the account you sign in with. Points are credited to the PR author and cannot be moved between accounts afterwards.",
      "Organizers and anyone who worked on the challenge targets, the scorer, or the rubric may compete for fun but are not eligible for prizes.",
    ],
  },
  {
    heading: "Scope of authorized testing",
    items: [
      `Your authorization to test covers the ${enabledApps.length} challenge ${enabledApps.length === 1 ? "target" : "targets"} only: ${appList}, in your own fork under the OWASP-CTF organization.`,
      "Explicitly out of scope: the CI scoring pipeline, the leaderboard, this website, the CTF Discord, and other contestants' accounts, forks, or machines. Testing any of those is not authorized by this event, and nothing here should be read as permission to do so.",
      "Found a real vulnerability in the scorer or this site? That is genuinely useful. Report it to an organizer rather than exploiting it. Doing so will not cost you anything.",
      "Automated mass-submission, or spamming pull requests to farm scoring runs, will get your account rate-limited or disqualified.",
    ],
  },
  {
    heading: "Your submissions",
    items: [
      "You submit work as a pull request against the target repository's main branch. Those repositories are OWASP projects under their own existing open-source licenses, and your contribution is offered under the license of the repository you are contributing to.",
      "Submit your own work. Using AI tooling to find and fix vulnerabilities is expected and encouraged here (see the Rules), but passing off another contestant's patch as yours is not.",
      "Don't publish full solutions or patches for others to copy while the event is running. Afterwards, write up whatever you like.",
      "Organizers may reference or showcase submitted patches when talking about the event.",
    ],
  },
  {
    heading: "Scoring and prizes",
    items: [
      "Each challenge is worth a fixed point value based on difficulty, awarded automatically when that challenge's regression test passes against your patched app. Your best-ever result per challenge counts.",
      "Revealing a hint deducts points from your leaderboard total. Hint purchases are final. There is no refund.",
      "Prizes go to the top individuals and top teams overall. You must be present at the closing ceremony to claim.",
      "Organizer decisions on scoring disputes are final.",
    ],
  },
];

export default function TermsPage() {
  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        eyebrow="The Fine Print"
        title="Terms"
        description="What taking part in this competition commits you to. Short, and specific to the CTF. The OWASP Foundation's own policies govern everything beyond it."
      />

      <section className="rounded-lg border border-white/[0.06] bg-[#16162a] p-6">
        <h2 className="mb-2 text-lg font-semibold text-white">What governs what</h2>
        <p className="text-sm leading-relaxed text-zinc-400">
          This page covers participation in the CTF. Beyond it, the OWASP Foundation&apos;s{" "}
          <ExternalLink href={event.owaspDisclaimerUrl}>General Disclaimer</ExternalLink> applies
          to this site and its content, including that everything here is provided without
          warranty of service or accuracy. Conduct is governed by the{" "}
          <Link
            href="/code-of-conduct"
            className="ds-link"
          >
            code of conduct
          </Link>
          , and what this site stores about you is described in the{" "}
          <Link href="/privacy" className="ds-link">
            privacy notice
          </Link>
          . Competition mechanics live in the{" "}
          <Link href="/rules" className="ds-link">
            rules
          </Link>
          .
        </p>
      </section>

      <div className="flex flex-col gap-6">
        {sections.map((section) => (
          <section
            key={section.heading}
            className="rounded-lg border border-white/[0.06] bg-[#16162a] p-6"
          >
            <h2 className="mb-4 text-lg font-semibold text-white">{section.heading}</h2>
            <ul className="flex flex-col gap-3">
              {section.items.map((item, i) => (
                <li key={i} className="flex gap-3 text-sm leading-relaxed text-zinc-400">
                  <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-[#2563eb]" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <p className="text-sm leading-relaxed text-muted">
        Questions about any of this? Ask an organizer at the OWASP CTF area or in the{" "}
        <ExternalLink href={event.discordUrl}>CTF Discord</ExternalLink>
        {event.contactEmail && (
          <>
            , or email{" "}
            <a href={`mailto:${event.contactEmail}`} className="ds-link font-mono">
              {event.contactEmail}
            </a>
          </>
        )}
        .
      </p>
    </div>
  );
}
