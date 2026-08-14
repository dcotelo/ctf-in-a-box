import type { Metadata } from "next";
import Link from "next/link";
import PageHeader from "@/components/page-header";
import { event } from "@/lib/site";

export const metadata: Metadata = {
  title: "Rules · OWASP CTF @ DEF CON 34",
  description: "Competition rules for the OWASP secure development CTF at DEF CON 34.",
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

// Rules are React nodes rather than plain strings so a rule can link to the
// document it defers to — a rule that says "the DEF CON CoC applies" is not
// much use without a way to go read it.
const sections: { heading: string; rules: React.ReactNode[] }[] = [
  {
    heading: "Teams",
    rules: [
      "You can compete solo or as a team of up to four. Teams are optional, and you can join or create one from your profile after signing in with GitHub.",
      "Each person belongs to at most one team at a time.",
      "Your GitHub login is your identity for scoring. Submit every pull request from the account you signed in with.",
    ],
  },
  {
    heading: "Fair play",
    rules: [
      "Only the six challenge targets (Juice Shop, DVWA, WebGoat, Security Shepherd, VulnerableApp, VAmPI) are in scope. Do not attack the CI scoring pipeline, the leaderboard, or other contestants' forks.",
      "Submit your own work. Don't publish full solutions or patches for others to copy during the event.",
      "Automated mass-submission or spamming pull requests to farm scoring runs will get your account rate-limited or disqualified.",
      <>
        <span className="text-white">Please use AI.</span>{" "}
        Finding and patching these vulnerabilities with an AI agent is the intended workflow,
        not a shortcut against the rules. It&apos;s the skill the event is built to teach. Start with OWASP&apos;s{" "}
        <ExternalLink href={event.secureAgentPlaybookUrl}>Secure Agent Playbook</ExternalLink>.
      </>,
    ],
  },
  {
    heading: "Conduct",
    rules: [
      <>
        The{" "}
        <ExternalLink href={event.defconCodeOfConductUrl}>DEF CON Code of Conduct</ExternalLink>{" "}
        applies at all times, alongside the{" "}
        <ExternalLink href={event.owaspCodeOfConductUrl}>OWASP Code of Conduct</ExternalLink>.
        Harassment of any kind ends your event. See our{" "}
        <Link
          href="/code-of-conduct"
          className="ds-link"
        >
          code of conduct page
        </Link>{" "}
        for how to report a problem.
      </>,
      "Be excellent to the volunteers, organizers, and your fellow competitors.",
      "Found a bug in a challenge, the scorer, or the site itself? Report it to an organizer instead of exploiting it for an unfair edge.",
    ],
  },
  {
    heading: "Scoring & prizes",
    rules: [
      "Each challenge is worth a fixed point value based on difficulty. Points post the moment your PR's regression test passes.",
      "Your best-ever result per challenge counts. A later successful patch always replaces an earlier miss.",
      "Revealing a hint deducts points from your total, and hint purchases are final.",
      "Prizes are awarded to the top individuals and top teams overall. Winners must be present to claim.",
      "Organizer decisions on scoring disputes are final.",
    ],
  },
];

export default function RulesPage() {
  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        eyebrow="The Fine Print"
        title="Rules"
        description="Keep the competition fair and the community welcoming. Breaking these can cost points or your spot in the event."
      />

      <div className="flex flex-col gap-6">
        {sections.map((section) => (
          <section
            key={section.heading}
            className="rounded-lg border border-white/[0.06] bg-[#16162a] p-6"
          >
            <h2 className="mb-4 text-lg font-semibold text-white">{section.heading}</h2>
            <ul className="flex flex-col gap-3">
              {section.rules.map((rule, i) => (
                <li key={i} className="flex gap-3 text-sm leading-relaxed text-zinc-400">
                  <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-[#2563eb]" />
                  <span>{rule}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <p className="text-sm leading-relaxed text-muted">
        Stuck, or need an organizer? Find one at the OWASP CTF area, or ask in the{" "}
        <ExternalLink href={event.discordUrl}>CTF Discord</ExternalLink>. See also the{" "}
        <Link href="/terms" className="ds-link">
          terms
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="ds-link">
          privacy notice
        </Link>
        .
      </p>
    </div>
  );
}
