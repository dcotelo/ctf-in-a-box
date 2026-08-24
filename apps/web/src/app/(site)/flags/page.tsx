// Server Component: reads the session and the classic module's public-safe
// data (`listChallenges()` never returns a flag, in either form — see
// classic-store.ts), then derives each challenge's PER-VIEWER status
// server-side and hands a plain view model down to <ClassicBoard>. Data (and
// auth) in, interactivity down — same split as quiz/page.tsx.
//
// Gated on the module registry rather than on auth: this route only exists at
// all when the classic module is enabled (module contract §5.4), so an event
// without it 404s here exactly like any other unknown route. Session is
// optional — a signed-out visitor can still see the challenges, same as the
// public leaderboard; only submitting requires auth, enforced by
// /api/classic/submit itself.

import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import ModuleEmptyState from "@/components/module-empty-state";
import PageHeader from "@/components/page-header";
import ClassicBoard, { type ClassicChallengeView, type ClassicStatus } from "@/components/classic-board";
import { isAdminLogin } from "@/lib/admin-auth";
import { auth } from "@/lib/auth";
import { getAdminSettings } from "@/lib/admin-store";
import {
  CLASSIC_COOLDOWN_SEC,
  getSolveCounts,
  getViewerClassic,
  listCategories,
  listChallenges,
  type ViewerClassic,
} from "@/lib/classic-store";
import { isModuleLive } from "@/lib/enabled-modules";
import { getResolvedModules } from "@/lib/resolved-modules";
import { redirectIfTeamless } from "@/lib/require-team";

const DEFAULT_TITLE = "Classic CTF";
const DEFAULT_BLURB = "Find the flag, submit the string, take the points.";

// `metadata` is a static export and cannot await Redis for the organizer's
// resolved title, so this is `generateMetadata` instead — see
// resolved-modules.ts for why every consumer of it renders dynamically.
export async function generateMetadata(): Promise<Metadata> {
  const mod = (await getResolvedModules()).find((m) => m.id === "classic");
  return {
    title: mod?.title ?? DEFAULT_TITLE,
    description: mod?.blurb ?? DEFAULT_BLURB,
  };
}

/** Derives this viewer's status for one challenge from the SAME solved/
 *  cooldown rule classic-store's `evaluateGate` enforces authoritatively at
 *  submit time — reimplemented here purely for display, using data this page
 *  already has (one `getViewerClassic` pipeline + the current admin
 *  settings) instead of an extra round trip per challenge. A stale or
 *  drifted read here is a display nit at worst: `submitFlag`'s Lua script
 *  re-checks both, atomically, against fresh state, and is the only thing
 *  that actually enforces the solved guard or the cooldown.
 *
 *  `now` defaults to `Date.now()` (read here, in a plain helper, rather than
 *  in the page component's own body) so the Server Component's render
 *  function stays a pure function of its props for React's rules. */
function deriveStatus(
  solve: ViewerClassic["solved"][string] | undefined,
  attempt: ViewerClassic["attempts"][string] | undefined,
  cooldownMs: number,
  now: number = Date.now(),
): ClassicStatus {
  if (solve) return { status: "solved", earnedPoints: solve.points };

  if (cooldownMs > 0 && attempt) {
    const lastMs = Date.parse(attempt.lastAt);
    if (Number.isFinite(lastMs)) {
      const retryAtMs = lastMs + cooldownMs;
      if (now < retryAtMs) return { status: "cooldown", retryAt: new Date(retryAtMs).toISOString() };
    }
  }

  return { status: "unsolved" };
}

export default async function FlagsPage() {
  if (!(await isModuleLive("classic"))) notFound();

  const session = await auth.api.getSession({ headers: await headers() });
  const login = (session?.user as { login?: string } | undefined)?.login;
  // Drives the empty state's authoring route only — same check `/admin` and
  // every `/api/admin/*` route gate on, so a link is never offered to someone
  // the admin page would then 403 at. Mirrors quiz/page.tsx.
  const viewerIsAdmin = await isAdminLogin(login);

  // Solves only count for a team (issue #153), and the submit route refuses a
  // teamless login. Sending them to set a team up first means nobody learns
  // that by submitting a flag and watching it not count. Before the loads
  // below, so a redirect never follows work that was thrown away.
  await redirectIfTeamless(login, { isAdmin: viewerIsAdmin });

  const [challenges, categories, solveCounts, viewerClassic, settings, modules] = await Promise.all([
    listChallenges(),
    listCategories(),
    getSolveCounts(),
    login ? getViewerClassic(login) : Promise.resolve<ViewerClassic>({ solved: {}, attempts: {} }),
    getAdminSettings(),
    getResolvedModules(),
  ]);

  const mod = modules.find((m) => m.id === "classic");
  const moduleTitle = mod?.title ?? DEFAULT_TITLE;
  // The organizer-editable blurb, which is the MODULE's own description of
  // itself and belongs in the page's lede — see quiz/page.tsx's identical
  // note on why this must never be read off the registry default directly.
  const blurb = mod?.blurb ?? DEFAULT_BLURB;

  const cooldownMs = (settings.classicCooldownSec ?? CLASSIC_COOLDOWN_SEC) * 1000;

  // Built field by field from the public `Challenge` shape plus this
  // challenge's solve count and this viewer's derived status — never a
  // spread of a raw store record, which is how a flag would leak.
  const viewChallenges: ClassicChallengeView[] = challenges.map((c) => ({
    id: c.id,
    title: c.title,
    category: c.category,
    description: c.description,
    points: c.points,
    solveCount: solveCounts.get(c.id) ?? 0,
    // Listed explicitly, like every field above it — this map is deliberately
    // NOT a spread of the store record, because a spread is how a flag leaks.
    caseSensitive: c.caseSensitive,
    ...deriveStatus(viewerClassic.solved[c.id], viewerClassic.attempts[c.id], cooldownMs),
  }));

  const solvedCount = viewChallenges.filter((c) => c.status === "solved").length;
  // Per-VIEWER state, so it sits above the board rather than in the header —
  // same reasoning as quiz/page.tsx's `progress` line: a page description
  // says what the page is, this says what *you* have done on it.
  const progress = login
    ? `You've solved ${solvedCount} of ${challenges.length} challenge${challenges.length === 1 ? "" : "s"}.`
    : "Sign in with GitHub to submit flags.";

  return (
    <div className="flex flex-col gap-8">
      {/* The eyebrow names WHAT THE PAGE LISTS, the title names the module —
          eyebrow={moduleTitle} rendered the same words twice, stacked
          ("QUIZ" over "Quiz"), which read as a template slip rather than a
          kicker (issue #200, tier 4). Same pattern as /challenges' own
          "Targets" eyebrow, and it stays accurate whatever the organizer
          renames the module to. */}
      <PageHeader eyebrow="Flag board" title={moduleTitle} description={blurb} />
      {/* The progress line sits OUTSIDE the empty-state branch on purpose —
          see quiz/page.tsx's identical note. Nesting it inside a
          `challenges.length > 0` branch would quietly take the "Sign in with
          GitHub" prompt away from a signed-out visitor looking at a board
          whose challenges haven't been authored yet. */}
      <div className="flex flex-col gap-4">
        <p className="text-sm text-zinc-400">{progress}</p>
        {challenges.length === 0 ? (
          <ModuleEmptyState
            message={
              viewerIsAdmin
                ? "No challenges yet. Add the first one from the admin panel."
                : "No challenges are available yet. Check back soon."
            }
            authoring={viewerIsAdmin ? { href: "/admin?tab=classic", label: "Author challenges" } : null}
          />
        ) : (
          <ClassicBoard categories={categories} challenges={viewChallenges} authenticated={Boolean(login)} />
        )}
      </div>
    </div>
  );
}
