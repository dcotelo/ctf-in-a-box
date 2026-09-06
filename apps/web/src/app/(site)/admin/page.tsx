// Gated Server Component: real gate is requireAdmin (the same check the
// /api/admin/* routes use — no second auth path). A signed-in non-admin
// should SEE a friendly "not an organizer" wall rather than a redirect or a
// 404, since the auth boundary is already enforced upstream; this is just a
// courteous dead end.

import type { Metadata } from "next";
import { headers } from "next/headers";
import PageHeader from "@/components/page-header";
import { phaseFromSettings } from "@/components/phase";
import { requireAdmin } from "@/lib/admin-auth";
import { getAdminSettings, getSyncStatus } from "@/lib/admin-store";
import { enabledApps, joinAppNames } from "@/lib/apps";
import { eventConfig } from "@/lib/event-config";
import type { ModuleSetupContent, OrgContext } from "@/lib/modules";
import { getModuleSetup, getResolvedModules } from "@/lib/resolved-modules";
import AdminControls from "./admin-controls";
import AdminHeader from "./admin-header";

export const metadata: Metadata = {
  title: "Admin",
  description: "Organizer controls and sync status.",
};

/** Which tab to open on arrival, from `?tab=<module id>`.
 *
 *  Read here rather than from `location.hash` in the tab shell: a hash is
 *  invisible to the server, so selecting from it means a post-hydration
 *  `setState` — a render the organizer sees flip, and a lint rule this repo
 *  takes seriously. A query param is on the request, so the very first
 *  server render already has the right panel open.
 *
 *  Unvalidated here on purpose: `AdminControls` owns the tab list, so it is
 *  the only thing that can say whether an id is real, and it falls back to
 *  the Event tab for anything it doesn't recognise. A link to a module that
 *  this event didn't enable lands on Event rather than on nothing. */
function tabParam(searchParams: Record<string, string | string[] | undefined>): string | undefined {
  const tab = searchParams.tab;
  return typeof tab === "string" ? tab : undefined;
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const gate = await requireAdmin(await headers());

  if (!gate.ok) {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader eyebrow="Admin" title="Forbidden" description="Organizer access only." />
        <div className="ds-card rounded-lg border border-white/[0.06] bg-[#16162a] px-5 py-10 text-center">
          <p className="text-sm text-zinc-400">
            You need to be an organizer to view this page.
          </p>
        </div>
      </div>
    );
  }

  // Independent catches: a Redis read failure degrades the affected block to
  // "unavailable" rather than 500ing the whole page (spec: Error handling).
  // A `sync` read failure is folded into the existing "no poller yet" render
  // (both come back as null) — the poller heartbeat is advisory, not a
  // correctness signal, so collapsing the two cases is an acceptable
  // simplification rather than adding a second null-ish state to track.
  //
  // `getResolvedModules` is deliberately NOT wrapped in a catch: it already
  // fails open to the registry defaults internally (see
  // src/lib/resolved-modules.ts), and it is `cache()`d per request, so this
  // call rides along with whatever the root layout's nav already paid for.
  const [settings, sync, modules, params] = await Promise.all([
    getAdminSettings().catch(() => null),
    getSyncStatus().catch(() => null),
    getResolvedModules(),
    searchParams,
  ]);

  // Each module's setup checklist, resolved HERE. The registry block is a
  // function of the org context (it names the targets and the GitHub org),
  // and AdminControls is a Client Component, so — exactly as /faq and
  // /how-to-play do for their blocks — the function is called on the server
  // and only its plain-data result is handed down. Built from the same
  // context the contestant pages use, so the setup panel and the FAQ can
  // never disagree about how many targets the event has.
  const ctx: OrgContext = {
    appCount: enabledApps.length,
    appList: joinAppNames(enabledApps.map((a) => a.name)),
    githubOrg: eventConfig.githubOrg,
  };
  const setups: Partial<Record<string, ModuleSetupContent>> = {};
  for (const mod of modules) {
    const setup = getModuleSetup(mod.id);
    if (setup) setups[mod.id] = setup(ctx);
  }

  const resolution = settings ? phaseFromSettings(settings) : null;

  return (
    <div className="flex flex-col gap-8">
      <AdminHeader eventName={eventConfig.name} resolution={resolution} />

      {/* The sync heartbeat is no longer its own card: Overview renders it as
          a one-line health readout with the full breakdown behind a
          disclosure (admin-redesign.md). `sync` is still fetched here and
          handed down. */}
      {settings ? (
        <AdminControls
          initial={settings}
          demoMode={process.env.DEMO_MODE === "1"}
          modules={modules}
          setups={setups}
          initialTab={tabParam(params)}
          viewerLogin={gate.login}
          sync={sync}
        />
      ) : (
        <div className="ds-card flex flex-col gap-3 rounded-lg border border-white/[0.06] bg-[#16162a] p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Controls</h2>
          <p className="text-sm text-zinc-400">Settings unavailable — Redis unreachable.</p>
        </div>
      )}
    </div>
  );
}
