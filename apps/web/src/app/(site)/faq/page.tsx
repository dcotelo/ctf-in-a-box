import type { Metadata } from "next";
import Link from "next/link";
import PageHeader from "@/components/page-header";
import FaqAccordion, { type QA } from "@/components/faq-accordion";
import { event } from "@/lib/site";
import { eventConfig } from "@/lib/event-config";

export const metadata: Metadata = {
  title: "FAQ",
  description: `Frequently asked questions about the ${event.name} secure development CTF.`,
};

const faqs: QA[] = [
  {
    q: "Do I need experience to compete?",
    a: "No. Every target has challenges across a range of difficulty, and points scale with it. Start with a low-point challenge on any app and work up.",
  },
  {
    q: "Can I compete solo?",
    a: "Yes, and it's the default. Teams are optional: you can join or create one from your profile after signing in, up to four people.",
  },
  {
    q: "What do I need to bring?",
    a: "Your own laptop with the dev tools you like to work in, a GitHub account, and a charger (outlets go fast). Everything else runs in your fork and in CI.",
  },
  {
    q: "How do I submit a solution?",
    a: (
      <>
        There&apos;s no flag to type in. Fork the target&apos;s repo under the{" "}
        {eventConfig.githubOrg} org, fix
        the vulnerability on a branch in your fork, and open a pull request against the
        repo&apos;s <code className="font-mono text-zinc-200">main</code>{" "}
        branch. That&apos;s the only branch the scorer watches, and there is no per-challenge
        branch. A GitHub Action builds your app, runs the rubric, and posts your score on the
        PR, usually in two to five minutes. See{" "}
        <Link href="/how-to-play" className="ds-link">
          How to Play
        </Link>{" "}
        for a worked example.
      </>
    ),
  },
  {
    q: "Do I need to run the target app locally?",
    a: "No. The scoring pipeline builds and runs your patched app in CI, so a PR is enough. Running it locally is just faster to iterate against while you work out the fix.",
  },
  {
    q: "Can I use AI tools to help?",
    a: (
      <>
        Yes, <span className="text-zinc-200">please do</span>. Using AI to analyze and remediate
        these vulnerabilities is the skillset this event is built around, not something to hide
        or work around. Bring whatever you already use, and point it at your fork. OWASP&apos;s
        own{" "}
        <a
          href={event.secureAgentPlaybookUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="ds-link"
        >
          Secure Agent Playbook
        </a>{" "}
        will get you further faster. It gives an agent structured, OWASP-grounded procedures for
        code review, dependency and secrets scanning, and API assessment, mapped to the same Top
        10 categories these challenges are graded against.
      </>
    ),
  },
  {
    q: "How is my progress tracked?",
    a: "Sign in with GitHub to claim your row on the live leaderboard and see a full per-app, per-challenge breakdown on your profile. Points are credited to the account that authored the pull request, so open your PRs from the same account you sign in with. Otherwise your score lands on a row you can't see.",
  },
  {
    q: "Are there hints?",
    a: "Some challenges offer one on your profile. Revealing a hint costs 10 points off your total, applied as soon as you reveal it, so save them for a challenge you're genuinely stuck on.",
  },
  {
    q: "My PR passed but I didn't get points. What happened?",
    a: "Check the scoring comment on the PR. If it says the score wasn't recorded, that's on our side. Push another commit and the run will record it. If it shows zero challenges patched, the rubric still reproduced the vulnerability, so the fix didn't fully close it. Points also only count for the PR author's account.",
  },
  {
    q: "Can I retry a challenge I didn't solve?",
    a: "Yes, as many times as you like. Push another commit and it re-scores. Your best-ever result per challenge counts, so a later fix replaces an earlier miss and you can never lose points you've already banked, even if a later patch breaks a challenge you'd already solved.",
  },
  {
    q: "Is there a prize?",
    a: "Yes. Prizes go to the top individuals and top teams overall. You must be present at the closing ceremony to claim.",
  },
  {
    q: "Where do I ask for help during the event?",
    a: (
      <>
        Find an organizer at the OWASP CTF area
        {event.discordUrl && (
          <>
            , or join the{" "}
            <a
              href={event.discordUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ds-link"
            >
              CTF Discord
            </a>
            , where scoring questions, stuck runs, and organizer announcements go
          </>
        )}
        .
      </>
    ),
  },
];

export default function FaqPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Questions"
        title="FAQ"
        description={
          <>
            Quick answers to the things contestants ask most. Still stuck? Find an organizer at
            the OWASP CTF area
            {event.discordUrl && (
              <>
                , or ask in the{" "}
                <a
                  href={event.discordUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ds-link"
                >
                  CTF Discord
                </a>
              </>
            )}
            .
          </>
        }
      />
      <FaqAccordion items={faqs} />
    </div>
  );
}
