// Gated Server Component: real gate is requireAdmin (the same check the
// /api/admin/* routes use — no second auth path). A signed-in non-admin
// should SEE a friendly "not an organizer" wall rather than a redirect or a
// 404, since the auth boundary is already enforced upstream; this is just a
// courteous dead end.

import type { Metadata } from "next";
import { headers } from "next/headers";
import PageHeader from "@/components/page-header";
import { requireAdmin } from "@/lib/admin-auth";
import { getAdminSettings, getSyncStatus } from "@/lib/admin-store";
import { formatRelativeTime } from "@/lib/relative-time";
import { getResolvedModules } from "@/lib/resolved-modules";
import AdminControls from "./admin-controls";

export const metadata: Metadata = {
  title: "Admin",
  description: "Organizer controls and sync status.",
};

export default async function AdminPage() {
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
  const [settings, sync, modules] = await Promise.all([
    getAdminSettings().catch(() => null),
    getSyncStatus().catch(() => null),
    getResolvedModules(),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow="Organizer" title="Admin" description="Event controls and sync status." />

      <div className="ds-card flex flex-col gap-3 rounded-lg border border-white/[0.06] bg-[#16162a] p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Status</h2>
        {sync ? (
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Last poll</dt>
              <dd className="font-mono text-white">
                {sync.lastPollAt ? formatRelativeTime(sync.lastPollAt) : "never"}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Ingested</dt>
              <dd className="font-mono tabular-nums text-white">{sync.ingested}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Repos polled</dt>
              <dd className="font-mono tabular-nums text-white">{sync.reposPolled}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Sync paused</dt>
              <dd className="font-mono text-white">{sync.paused ? "yes" : "no"}</dd>
            </div>
            {sync.lastError && (
              <div className="col-span-2 sm:col-span-4">
                <dt className="text-xs uppercase tracking-wide text-muted">Last error</dt>
                <dd className="font-mono text-xs text-[#e53e3e]">{sync.lastError}</dd>
              </div>
            )}
          </dl>
        ) : (
          <p className="text-sm text-zinc-400">Sync not running.</p>
        )}
      </div>

      {settings ? (
        <AdminControls initial={settings} demoMode={process.env.DEMO_MODE === "1"} modules={modules} />
      ) : (
        <div className="ds-card flex flex-col gap-3 rounded-lg border border-white/[0.06] bg-[#16162a] p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Controls</h2>
          <p className="text-sm text-zinc-400">Settings unavailable — Redis unreachable.</p>
        </div>
      )}
    </div>
  );
}
