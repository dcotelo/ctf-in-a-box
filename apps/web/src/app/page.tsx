// The landing page is a PLATFORM frame: logo, event name, dates, countdown,
// the how-to-play/leaderboard/Discord CTAs and the progress-tracking card. The
// copy that describes what contestants actually *do* belongs to whichever
// modules the event enables, and is pulled from their registry `home` blocks —
// so a quiz-only event never advertises forks, patches or pull requests.
//
// This is a Server Component and must stay one. `ModuleHome.intro`/`.steps`
// are FUNCTIONS: they are called here, server-side, and only the resulting
// strings are rendered. Never pass a ModuleHome (or anything holding it) into
// a "use client" component — React's flight serializer rejects function-valued
// props. That is also why `home` is reached via the server-only
// `getModuleHome` rather than off a ResolvedModule; see lib/modules.ts.
import { Fragment } from "react";
import Image from "next/image";
import Link from "next/link";
import EventCountdown from "@/components/event-countdown";
import SiteFooter from "@/components/site-footer";
import { enabledApps, enabledTotalChallenges, enabledTotalMaxPoints, joinAppNames } from "@/lib/apps";
import { getChallengeCatalog } from "@/lib/challenges";
import { isModuleEnabled, type HomeContext } from "@/lib/modules";
import { getModuleHome, getResolvedModules } from "@/lib/resolved-modules";
import { event } from "@/lib/site";

// Tailwind scans for literal class strings, so the step grid's widest breakpoint
// is looked up rather than interpolated. Four steps (secure-development) keep
// the four-up row the page has always rendered.
const STEP_GRID_LG: Record<number, string> = {
  1: "lg:grid-cols-1",
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
};

export default async function Home() {
  const catalog = await getChallengeCatalog();
  const sortedApps = [...enabledApps].sort((a, b) => a.name.localeCompare(b.name));

  const appList = joinAppNames(enabledApps.map((a) => a.name));
  const topByPoints = [...enabledApps].sort((a, b) => b.maxPoints - a.maxPoints).slice(0, 2);
  const topAppsList = joinAppNames(topByPoints.map((a) => a.name));

  const secureDevelopment = isModuleEnabled("secure-development");

  // Live facts handed to every module's copy, built once so two modules can't
  // disagree about how many targets the event has.
  const ctx: HomeContext = {
    appCount: enabledApps.length,
    appList,
    topAppsList,
    totalChallenges: catalog?.total ?? enabledTotalChallenges,
  };

  // Registry order, organizer-resolved titles, and — crucially — plain strings:
  // intro() and steps() are invoked HERE, on the server. Nothing below this
  // line holds a function.
  const sections = (await getResolvedModules()).flatMap((module) => {
    const home = getModuleHome(module.id);
    if (!home) return [];
    return [
      {
        id: module.id,
        title: module.title,
        tagline: home.tagline,
        intro: home.intro(ctx),
        expect: home.expect,
        steps: home.steps(ctx),
        cta: home.cta,
        extra: home.extra,
      },
    ];
  });

  // Zero modules with a home block is a valid event, not an error: the frame
  // renders on its own.
  const taglines = sections.map((s) => s.tagline).join(" · ");

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
            {taglines && (
              <p className="text-lg font-medium uppercase tracking-[0.25em] text-[#14b8a6]">
                {taglines}
              </p>
            )}
          </div>

          {(event.dates || event.location) && (
            <div className="flex items-center gap-3 text-sm text-zinc-400">
              {event.dates && <span>{event.dates}</span>}
              {event.dates && event.location && <span className="text-zinc-600">&middot;</span>}
              {event.location && <span>{event.location}</span>}
            </div>
          )}

          {event.ctfStartsAt && <EventCountdown />}

          {/* CTAs: platform first, then each enabled module's own entry point. */}
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/how-to-play"
              className="rounded-md bg-[#2563eb] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#2563eb]/90"
            >
              How to play
            </Link>
            {sections.map(
              (section) =>
                section.cta && (
                  <Link
                    key={section.id}
                    href={section.cta.href}
                    className="rounded-md border border-white/10 bg-white/[0.03] px-5 py-2.5 text-sm text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                  >
                    {section.cta.label}
                  </Link>
                ),
            )}
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

          {sections.map((section) => (
            <p
              key={section.id}
              className="max-w-2xl text-balance text-base leading-relaxed text-zinc-400"
            >
              {section.intro}
            </p>
          ))}

        </main>

        {/* Bottom accent */}
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#2563eb]/20 to-transparent" />
      </div>

      <div className="mx-auto flex w-full max-w-6xl flex-col gap-16 px-4 py-16 sm:px-6">
        {sections.map((section) => (
          <Fragment key={section.id}>
            {/* What to expect. With one module the kicker stays the generic
                "What to expect"; with several, each section is headed by that
                module's organizer-resolved title so they stay tellable apart. */}
            <section className="flex flex-col gap-6">
              <div className="flex flex-col gap-3">
                <p className="text-xs font-medium uppercase tracking-[0.25em] text-[#14b8a6]">
                  {sections.length > 1 ? section.title : "What to expect"}
                </p>
                <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
                  {section.expect.heading}
                </h2>
                <p className="max-w-2xl text-base leading-relaxed text-zinc-400">
                  {section.expect.lede}
                </p>
                <div className="mt-1 h-px w-full bg-gradient-to-r from-[#2563eb]/40 via-white/[0.06] to-transparent" />
              </div>

              <ol
                className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${STEP_GRID_LG[section.steps.length] ?? "lg:grid-cols-4"}`}
              >
                {section.steps.map((step, i) => (
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

            {/* A module's optional extra section. For secure-development this is
                "Please use AI" — the event's actual thesis, so it gets its own
                section rather than a line inside the steps — and it carries the
                Secure Agent Playbook card, which is secure-development's own
                recommendation and renders nowhere else. */}
            {section.extra && (
              <section className="flex flex-col gap-6">
                <div className="flex flex-col gap-3">
                  <p className="text-xs font-medium uppercase tracking-[0.25em] text-[#14b8a6]">
                    {section.extra.kicker}
                  </p>
                  <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
                    {section.extra.heading}
                  </h2>
                  <p className="max-w-2xl text-base leading-relaxed text-zinc-400">
                    {section.extra.body}
                  </p>
                  <div className="mt-1 h-px w-full bg-gradient-to-r from-[#2563eb]/40 via-white/[0.06] to-transparent" />
                </div>

                {section.id === "secure-development" && (
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
                )}
              </section>
            )}
          </Fragment>
        ))}

        {/* Targets. secure-development's content — the registry holds copy, not
            markup, so the grid itself stays here behind the module gate. */}
        {secureDevelopment && (
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
        )}

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
