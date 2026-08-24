// 404 boundary for /flags/[id] — which, unlike the board's, has TWO causes:
// the classic module being off (same as the board), or a challenge id that
// doesn't exist (a typo, or an organizer removed the challenge). The board's
// boundary asserts "your link is fine", which is exactly wrong for a bad id —
// so this one checks the module's live state itself and says whichever is
// actually true.

import NotFoundBody, { getNotFoundRoutes } from "@/components/not-found-body";
import { isModuleLive } from "@/lib/enabled-modules";
import { getAdminSettings } from "@/lib/admin-store";
import { moduleDefById } from "@/lib/modules";

export default async function ChallengeNotFound() {
  const routes = await getNotFoundRoutes();
  // The EFFECTIVE title, independent of liveness: getResolvedModules() only
  // returns LIVE modules, so in the disabled branch — the one that needs the
  // name most — it degraded to "This module" (CodeRabbit, #209 round 3). The
  // organizer's override comes straight off settings, falling open to the
  // registry default when unset or unreadable.
  const settings = await getAdminSettings().catch(() => null);
  const name =
    settings?.moduleOverrides?.classic?.title ?? moduleDefById("classic")?.displayName ?? "This module";

  if (!(await isModuleLive("classic"))) {
    // Same story the board's boundary tells, for the same reason.
    return (
      <NotFoundBody
        routes={routes}
        eyebrow="Not running"
        title={`${name} is switched off`}
        description={`This event isn't running ${name} at the moment. Your link is fine and nothing you have already solved is affected — an organizer turned the module off, and it can come back just as quickly. Here is what this event does have open.`}
      />
    );
  }

  return (
    <NotFoundBody
      routes={routes}
      eyebrow="404"
      title="That challenge isn't on the board"
      description="The board is running, but no challenge lives at this address — the link may have a typo, or an organizer removed the challenge. Everything still on offer is one click away."
    />
  );
}
