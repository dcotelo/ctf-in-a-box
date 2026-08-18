import "server-only";
import { getAdminSettings } from "@/lib/admin-store";
import { resolveModules, type ResolvedModule } from "@/lib/modules";

/** Modules with their organizer-authored names applied.
 *
 *  Fails OPEN: a settings-read failure resolves to registry defaults rather
 *  than throwing. This is deliberately the opposite of the quiz gates, which
 *  fail closed — a wrong display name is cosmetic, while a wrong gate decision
 *  awards points. A Redis outage should render the stock nav, not a header
 *  with no links in it. */
export async function getResolvedModules(): Promise<readonly ResolvedModule[]> {
  const overrides = await getAdminSettings()
    .then((s) => s.moduleOverrides)
    .catch(() => ({}));
  return resolveModules(overrides);
}
