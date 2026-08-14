import Image from "next/image";
import Link from "next/link";
import EventCountdown from "@/components/event-countdown";
import SiteFooter from "@/components/site-footer";
import { enabledApps, enabledTotalChallenges, enabledTotalMaxPoints, joinAppNames } from "@/lib/apps";
import { getChallengeCatalog } from "@/lib/challenges";
import { event } from "@/lib/site";

export default async function Home() {
  const catalog = await getChallengeCatalog();
  const sortedApps = [...enabledApps].sort((a, b) => a.name.localeCompare(b.name));

  const appList = joinAppNames(enabledApps.map((a) => a.name));
  const topByPoints = [...enabledApps].sort((a, b) => b.maxPoints - a.maxPoints).slice(0, 2);
  const topAppsList = joinAppNames(topByPoints.map((a) => a.name));
  const STEPS = [
    {
      title: "Pick a target",
      body: `Choose from ${enabledApps.length} real, deliberately vulnerable OWASP ${enabledApps.length === 1 ? "app" : "apps"}: ${appList}.`,
    },
    {
      title: "Find the vulnerability",
      body: "Work through the OWASP Top 10 (Web and API) to identify a real flaw in the target's source. Please use AI. Point an agent at the codebase. That's the workflow this event is built to teach.",
    },
    {
      title: "Patch it and open a PR",
      body: "Fix the vulnerability in your fork, then submit a pull request against the repo's main branch. This is secure development, not flag hunting.",
    },
    {
      title: "Get scored automatically",
      body: "A GitHub Action runs that challenge's regression test against your patched app. A passing test scores points immediately, no manual grading.",
    },
  ];
  return (
    <div className="flex flex-1 flex-col">
      <div className="relative flex flex-col items-center justify-center overflow-hidden bg-[#1a1a2e] py-20">
        {/* Subtle scanline overlay */}
        <div
          className="pointer-events-none absolute inset-0 z-10 opacity-[0.03]"
          style={{
            background:
              "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.05) 2px, rgba(255,255,255,0.05) 4px)",
          }}
        />

        {/* Slow scanline bar */}
        <div
          className="pointer-events-none absolute inset-x-0 z-10 h-[1px] bg-white/[0.04]"
          style={{ animation: "scanline 10s linear infinite" }}
        />

        {/* Content */}
        <main className="relative z-20 flex flex-col items-center gap-10 px-6 text-center">
          {/* OWASP Logo */}
          <Image
            src="/owasp-logo.png"
            alt="OWASP"
            width={280}
            height={97}
            priority
            className="invert"
          />

          {/* Security-themed icon row */}
          <div className="flex items-center gap-4">
            {/* Clock / Time - red */}
            <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-[#e53e3e] text-[#e53e3e]">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 6v6l4 2" />
              </svg>
            </div>
            {/* Shield - yellow */}
            <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-[#d4a017] text-[#d4a017]">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </div>
            {/* Lock - blue */}
            <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-[#2563eb] text-[#2563eb]">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            {/* People - teal */}
            <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-[#14b8a6] text-[#14b8a6]">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
          </div>

          {/* Title */}
          <div className="flex flex-col items-center gap-3">
            <h1
              className="text-5xl font-bold tracking-tight text-white sm:text-7xl"
              style={{ animation: "pulse-glow 4s ease-in-out infinite" }}
            >
              {event.name}
            </h1>
            <p className="text-lg font-medium uppercase tracking-[0.25em] text-[#14b8a6]">
              Secure Development CTF
            </p>
          </div>

          {(event.dates || event.location) && (
            <div className="flex items-center gap-3 text-sm text-zinc-400">
              {event.dates && <span>{event.dates}</span>}
              {event.dates && event.location && <span className="text-zinc-600">&middot;</span>}
              {event.location && <span>{event.location}</span>}
            </div>
          )}

          {event.ctfStartsAt && <EventCountdown />}

          {/* CTAs */}
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/how-to-play"
              className="rounded-md bg-[#2563eb] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#2563eb]/90"
            >
              How to play
            </Link>
            <Link
              href="/challenges"
              className="rounded-md border border-white/10 bg-white/[0.03] px-5 py-2.5 text-sm text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
            >
              Browse targets
            </Link>
            <Link
              href="/leaderboard"
              className="rounded-md border border-white/10 bg-white/[0.03] px-5 py-2.5 text-sm text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
            >
              Live leaderboard
            </Link>
            {event.discordUrl && (
              <a
                href={event.discordUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md border border-white/10 bg-white/[0.03] px-5 py-2.5 text-sm text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
              >
                Join the Discord
              </a>
            )}
          </div>

          <p className="max-w-2xl text-balance text-base leading-relaxed text-zinc-400">
            Break real vulnerabilities in {enabledApps.length} OWASP training{" "}
            {enabledApps.length === 1 ? "app" : "apps"}, patch them for real, and ship
            the fix as a GitHub pull request. CI validates your patch and scores it automatically.
            Practice the full secure development lifecycle, not just flag-hunting.
          </p>

        </main>

        {/* Bottom accent */}
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#2563eb]/20 to-transparent" />
      </div>

      {/* What to expect */}
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-16 px-4 py-16 sm:px-6">
        <section className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <p className="text-xs font-medium uppercase tracking-[0.25em] text-[#14b8a6]">
              What to expect
            </p>
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              This isn&rsquo;t flag hunting. It&rsquo;s the real fix workflow
            </h2>
            <p className="max-w-2xl text-base leading-relaxed text-zinc-400">
              Every challenge maps to a real, disclosed vulnerability class from the OWASP Top 10.
              You find it, patch it, and prove the fix with a passing regression test, the same
              loop a security engineer runs against a live codebase.
            </p>
            <div className="mt-1 h-px w-full bg-gradient-to-r from-[#2563eb]/40 via-white/[0.06] to-transparent" />
          </div>

          <ol className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, i) => (
              <li
                key={step.title}
                className="ds-card flex flex-col gap-3 rounded-lg border border-white/[0.06] bg-[#16162a] p-5"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full border border-[#2563eb]/40 bg-[#2563eb]/10 font-mono text-sm font-bold tabular-nums text-[var(--accent-blue-link)]">
                  {i + 1}
                </span>
                <h3 className="font-semibold text-white">{step.title}</h3>
                <p className="text-sm leading-relaxed text-zinc-400">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Bring an AI agent. This is the event's actual thesis, so it gets its
            own section rather than a line inside the steps. */}
        <section className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <p className="text-xs font-medium uppercase tracking-[0.25em] text-[#14b8a6]">
              Bring your agent
            </p>
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Please use AI
            </h2>
            <p className="max-w-2xl text-base leading-relaxed text-zinc-400">
              This isn&rsquo;t tolerated, it&rsquo;s the point. Reviewing code, finding the flaw,
              and writing the patch with an AI agent is the skill this event exists to build.
              Bring whatever you already use (Claude Code, Copilot, Cursor, your own
              harness) and let it read the target.
            </p>
            <div className="mt-1 h-px w-full bg-gradient-to-r from-[#2563eb]/40 via-white/[0.06] to-transparent" />
          </div>

          <div className="ds-card flex flex-col gap-4 rounded-lg border border-white/[0.06] bg-[#16162a] p-6">
            <h3 className="text-lg font-semibold text-white">
              Start with the OWASP Secure Agent Playbook
            </h3>
            <p className="max-w-3xl text-sm leading-relaxed text-zinc-400">
              OWASP&rsquo;s own open-source playbook for pointing an AI agent at a codebase. It
              ships structured, OWASP-grounded procedures for security code review, dependency
              and secrets scanning, and API and web assessment, each one mapped to the
              same OWASP Top 10 categories these challenges are graded against. It turns
              &ldquo;find the bug&rdquo; into a repeatable method, which is exactly what you want
              against 300-plus challenges on a deadline.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <a
                href={event.secureAgentPlaybookUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md bg-[#2563eb] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#2563eb]/90"
              >
                Get the playbook
              </a>
              <Link
                href="/how-to-play"
                className="rounded-md border border-white/10 bg-white/[0.03] px-5 py-2.5 text-sm text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
              >
                See it in a worked example
              </Link>
            </div>
          </div>
        </section>

        {/* Targets */}
        <section className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <p className="text-xs font-medium uppercase tracking-[0.25em] text-[#14b8a6]">
              {enabledApps.length} real {enabledApps.length === 1 ? "target" : "targets"}
            </p>
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              {catalog
                ? `${catalog.total} challenges up for grabs`
                : `${enabledTotalChallenges} challenges, ${enabledTotalMaxPoints} points up for grabs`}
            </h2>
            <p className="max-w-2xl text-base leading-relaxed text-zinc-400">
              Each app is a well-known, deliberately vulnerable OWASP project. Points scale with
              difficulty, and the deeper flaws in {topAppsList} pay out the most.
            </p>
            <div className="mt-1 h-px w-full bg-gradient-to-r from-[#2563eb]/40 via-white/[0.06] to-transparent" />
          </div>

          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sortedApps.map((app) => (
              <li key={app.id}>
                <Link
                  href="/challenges"
                  className="ds-card group flex h-full flex-col gap-3 rounded-lg border border-white/[0.06] bg-[#16162a] p-5 transition-all hover:-translate-y-0.5"
                  style={{ ["--accent" as string]: app.accent }}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className="flex h-10 w-10 items-center justify-center rounded-full border-2 transition-shadow"
                      style={{ color: app.accent, borderColor: app.accent }}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d={app.icon} />
                      </svg>
                    </span>
                    <span className="font-mono text-xs tabular-nums text-muted">
                      {catalog?.byApp[app.id]?.length ?? app.challengeCount} challenges
                    </span>
                  </div>
                  <h3 className="text-lg font-semibold text-white">{app.name}</h3>
                  <p className="text-sm leading-relaxed text-zinc-400">{app.blurb}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {/* Tracking */}
        <section className="ds-card flex flex-col gap-4 rounded-lg border border-white/[0.06] bg-[#16162a] p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-xl">
            <h3 className="text-lg font-semibold text-white">Track your progress live</h3>
            <p className="mt-1 text-sm leading-relaxed text-zinc-400">
              Sign in with GitHub to claim your row on the leaderboard, follow your patched and
              non-patched count per app on your profile, and team up with other contestants.
            </p>
          </div>
          <div className="flex flex-none flex-wrap gap-3">
            <Link
              href="/leaderboard"
              className="rounded-md bg-[#2563eb] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2563eb]/90"
            >
              View leaderboard
            </Link>
            <Link
              href="/how-to-play"
              className="rounded-md border border-white/10 px-4 py-2 text-sm text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
            >
              Read the full guide
            </Link>
          </div>
        </section>
      </div>

      <SiteFooter />
    </div>
  );
}
