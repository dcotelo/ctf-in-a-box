import type { Metadata } from "next";
import Link from "next/link";
import PageHeader from "@/components/page-header";
import { enabledApps, joinAppNames } from "@/lib/apps";
import { event } from "@/lib/site";

const appList = joinAppNames(enabledApps.map((a) => a.name));

export const metadata: Metadata = {
  title: "How to Play",
  description: "Step-by-step guide to the OWASP secure development CTF: fork a target, patch a real vulnerability, open a PR, and get scored automatically.",
};

const steps = [
  {
    title: "Sign in with GitHub",
    body: "Use the sign-in button in the header. Your GitHub login is how the leaderboard and your profile track your progress. The scorer credits points to the account that authors the pull request, so play from the same account you sign in with.",
  },
  {
    title: "Pick a target and a challenge",
    body: `Browse the ${enabledApps.length} vulnerable ${enabledApps.length === 1 ? "app" : "apps"} on the Challenges page: ${appList}. Each has dozens of independent challenges at different difficulty levels; pick any one to start.`,
  },
  {
    title: "Find the vulnerability",
    body: "Work the target like a real audit: read the source, exercise the app, and identify the OWASP Top 10 flaw behind the challenge. Please use AI here. Point an agent at the codebase and have it do the analysis and draft the remediation. That's the intended workflow, not a shortcut around it.",
  },
  {
    title: "Patch it and open a pull request",
    body: "Fork the target's repo under the OWASP-CTF org, fix the vulnerability on a branch in your fork, and open a PR back against the repo's main branch. This is secure development practice, not flag hunting. The fix itself is the deliverable.",
  },
  {
    title: "Get scored automatically",
    body: "A GitHub Action builds your patched app and runs the full regression suite against it. Every passing challenge test scores its points immediately: no manual grading, no waiting on an organizer. Pushing more fixes to the same PR re-scores it.",
  },
];

// Worked example: the Login Admin SQL injection in the Juice Shop fork. The
// before/after mirrors routes/login.ts on the target's default branch and the
// canonical parameterized-query fix, so a contestant who follows this
// verbatim genuinely scores (and closes the two sibling login challenges).
const walkthrough: { title: string; body: string; code?: string; lang?: "shell" | "ts" }[] = [
  {
    title: "Fork the target and clone your fork",
    body: "Fork OWASP-CTF/juice-shop on GitHub (or with the gh CLI), then clone it. The default branch is the one the scorer watches.",
    lang: "shell",
    code: `gh repo fork OWASP-CTF/juice-shop --clone
cd juice-shop`,
  },
  {
    title: "Create a branch for your fix",
    body: "One branch per fix keeps your PRs clean and easy to re-score.",
    lang: "shell",
    code: "git checkout -b fix/login-sql-injection",
  },
  {
    title: "Find the flaw",
    body: "The Login Admin challenge (A05: Injection) lives in routes/login.ts. User input is concatenated straight into the SQL string, so an email like ' OR 1=1-- logs in as the first user in the table: the admin.",
    lang: "ts",
    code: `// routes/login.ts: the vulnerable query
models.sequelize.query(
  \`SELECT * FROM Users WHERE email = '\${req.body.email || ''}'
    AND password = '\${security.hash(req.body.password || '')}'
    AND deletedAt IS NULL\`,
  { model: UserModel, plain: true }
)`,
  },
  {
    title: "Patch it",
    body: "Replace string interpolation with bind parameters. The database driver now treats the email and password strictly as data, so they can never rewrite the query itself.",
    lang: "ts",
    code: `// routes/login.ts: parameterized fix
models.sequelize.query(
  'SELECT * FROM Users WHERE email = $1 AND password = $2 AND deletedAt IS NULL',
  {
    model: UserModel,
    plain: true,
    bind: [req.body.email || '', security.hash(req.body.password || '')]
  }
)`,
  },
  {
    title: "Commit and push to your fork",
    body: "Write the commit message like you would on a real security fix: say what was vulnerable and how the patch closes it.",
    lang: "shell",
    code: `git add routes/login.ts
git commit -m "Fix SQL injection in login route with bind parameters"
git push -u origin fix/login-sql-injection`,
  },
  {
    title: "Open the PR against main",
    body: "The base repo is OWASP-CTF/juice-shop and the base branch is main. The scorer only watches that branch. The GitHub web UI's “Compare & pull request” button works too; just check the base branch.",
    lang: "shell",
    code: `gh pr create --repo OWASP-CTF/juice-shop --base main \\
  --title "Fix SQL injection in login route" \\
  --body "Replaced string-interpolated SQL with bind parameters."`,
  },
  {
    title: "Watch the scorer do its thing",
    body: "The ctf-score Action builds your patched app, boots it in a sandbox, and runs the challenge regression suite against it. When it finishes you'll get a “🏁 Score recorded” comment on the PR, and your points appear on the leaderboard and your profile moments later.",
  },
];

function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="mt-3 overflow-x-auto rounded-md border border-white/10 bg-[#0e0e1a] p-3 font-mono text-xs leading-relaxed text-zinc-300">
      {code}
    </pre>
  );
}

export default function HowToPlayPage() {
  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        eyebrow="Getting Started"
        title="How to Play"
        description="New to the competition? Here's everything you need to go from a GitHub sign-in to your first patched challenge."
      />

      {/* Workflow callout */}
      <div className="rounded-lg border border-[#2563eb]/30 bg-[#2563eb]/[0.06] p-5">
        <p className="text-xs font-medium uppercase tracking-wider text-[var(--accent-blue-link)]">The loop</p>
        <p className="mt-2 font-mono text-sm text-zinc-300">
          find the flaw <span className="text-zinc-600">→</span> patch it{" "}
          <span className="text-zinc-600">→</span> open a PR{" "}
          <span className="text-zinc-600">→</span> CI scores it
        </p>
        <p className="mt-2 text-sm text-zinc-400">
          There are no flags to submit. Every challenge is scored by an automated regression test
          that only passes once the vulnerability is actually fixed.
        </p>
      </div>

      {/* AI callout. Sits above the steps because it changes how you do step 4,
          and contestants who skim only the numbered list still see it. */}
      <div className="rounded-lg border border-[#14b8a6]/30 bg-[#14b8a6]/[0.06] p-5">
        <p className="text-xs font-medium uppercase tracking-wider text-[#14b8a6]">
          Please use AI
        </p>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          Solving these with an AI agent is the intended path, not a loophole. Bring whatever you
          already use and let it read the target. The fastest way to get a useful result is
          OWASP&rsquo;s own{" "}
          <a
            href={event.secureAgentPlaybookUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ds-link"
          >
            Secure Agent Playbook
          </a>
          : structured, OWASP-grounded procedures for security code review, dependency and
          secrets scanning, and API assessment, mapped to the same Top 10 categories these
          challenges are graded against. Point it at your fork before you start reading files by
          hand.
        </p>
      </div>

      {/* Numbered steps */}
      <ol className="flex flex-col gap-4">
        {steps.map((step, i) => (
          <li
            key={step.title}
            className="flex gap-4 rounded-lg border border-white/[0.06] bg-[#16162a] p-5"
          >
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full border border-[#2563eb]/40 bg-[#2563eb]/10 font-mono text-sm font-bold tabular-nums text-[var(--accent-blue-link)]">
              {i + 1}
            </span>
            <div>
              <h2 className="font-semibold text-white">{step.title}</h2>
              <p className="mt-1 text-sm leading-relaxed text-zinc-400">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>

      {/* Worked example */}
      <section className="flex flex-col gap-5" aria-labelledby="first-patch">
        <div className="flex flex-col gap-3">
          <p className="text-xs font-medium uppercase tracking-[0.25em] text-[#14b8a6]">
            Worked example
          </p>
          <h2 id="first-patch" className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Your first patch, end to end
          </h2>
          <p className="max-w-2xl text-sm leading-relaxed text-zinc-400">
            Here&rsquo;s the whole loop on a real challenge: <span className="text-zinc-200">Login Admin</span> in
            Juice Shop, a classic SQL injection. Follow it verbatim to land your first points and
            see exactly what a scoring run looks like, then repeat the pattern on every other
            challenge.
          </p>
        </div>

        <ol className="flex flex-col gap-4">
          {walkthrough.map((step, i) => (
            <li
              key={step.title}
              className="rounded-lg border border-white/[0.06] bg-[#16162a] p-5"
            >
              <div className="flex gap-4">
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full border border-[#14b8a6]/40 bg-[#14b8a6]/10 font-mono text-sm font-bold tabular-nums text-[#14b8a6]">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-white">{step.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-zinc-400">{step.body}</p>
                  {step.code && <CodeBlock code={step.code} />}
                </div>
              </div>
            </li>
          ))}
        </ol>

        <div className="rounded-lg border border-[#14b8a6]/30 bg-[#14b8a6]/[0.06] p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-[#14b8a6]">Bonus</p>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            That one-line fix doesn&rsquo;t just close Login Admin. The same injection powers the{" "}
            <span className="text-zinc-200">Login Bender</span> and{" "}
            <span className="text-zinc-200">Login Jim</span> challenges, so a single parameterized
            query scores all three. Real fixes often cascade like this: patch the root cause, not
            the symptom.
          </p>
        </div>
      </section>

      {/* Good-to-know */}
      <div className="flex flex-col gap-3 rounded-lg border border-white/[0.06] bg-[#16162a] p-5">
        <h2 className="font-semibold text-white">Good to know</h2>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed text-zinc-400">
          <li>
            Every push to an open PR re-runs the scorer, and the run evaluates your whole app, so
            you can keep stacking fixes on one branch or open a fresh PR per fix, whichever you
            prefer.
          </li>
          <li>
            Your best-ever result per challenge is what counts. A later fix always replaces an
            earlier miss; you can never lose points by trying.
          </li>
          <li>
            Points are credited to the GitHub account that authored the PR. Team totals are the
            sum of what each member lands individually.
          </li>
        </ul>
      </div>

      {/* Scoring note */}
      <div className="flex flex-col gap-3 rounded-lg border border-white/[0.06] bg-[#16162a] p-5">
        <h2 className="font-semibold text-white">How scoring works</h2>
        <p className="text-sm leading-relaxed text-zinc-400">
          Every challenge is worth a fixed number of points based on difficulty, and harder
          vulnerabilities pay out more. Points are awarded the moment your PR&rsquo;s regression
          test passes, and your best-ever result for each challenge is what counts, so a later
          fix always replaces an earlier miss. Your live total, per-app breakdown, and
          patched and non-patched counts are visible on your profile once you&rsquo;re signed in.
        </p>
        <div className="flex flex-wrap gap-3 pt-1">
          <Link
            href="/challenges"
            className="rounded-md border border-[#2563eb] bg-[#2563eb]/10 px-4 py-2 text-sm font-medium text-[var(--accent-blue-link)] transition-colors hover:bg-[#2563eb]/20"
          >
            Browse challenges
          </Link>
          <Link
            href="/rules"
            className="rounded-md border border-white/10 px-4 py-2 text-sm text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
          >
            Read the rules
          </Link>
          <Link
            href="/leaderboard"
            className="rounded-md border border-white/10 px-4 py-2 text-sm text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
          >
            View the leaderboard
          </Link>
        </div>
      </div>

      <p className="text-sm leading-relaxed text-muted">
        Stuck, or need an organizer? Find one at the OWASP CTF area, or ask in the{" "}
        <a
          href={event.discordUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="ds-link"
        >
          CTF Discord
        </a>
        .
      </p>
    </div>
  );
}
