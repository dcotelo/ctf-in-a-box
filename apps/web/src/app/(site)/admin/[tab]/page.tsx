// `/admin/<tab>` — Overview, Activity, Insights, Support, a module id, Event,
// Hints, Admins. What the sidebar links to, and what an organizer can
// bookmark, paste into a runbook, or read out loud without a query string.
//
// The panel is admin-panel.tsx, shared with `/admin?tab=<id>`: one gate, one
// set of reads, one error state, whichever shape the URL took.
//
// The segment is NOT validated here. `AdminControls` owns the tab list — it
// is the only thing that knows which modules this event enabled — and falls
// back to Overview for anything it doesn't recognise, so `/admin/nonsense`
// opens the panel on Overview rather than 404ing an organizer who mistyped,
// or who followed a link written for an event with different modules.

import type { Metadata } from "next";
import AdminPanel from "@/app/(site)/admin/admin-panel";
import { resolveAdminTab } from "@/app/(site)/admin/admin-controls";

export const metadata: Metadata = {
  title: "Admin",
  description: "Organizer controls and sync status.",
};

export default async function AdminTabPage({
  params,
  searchParams,
}: {
  params: Promise<{ tab: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // `?tab=` is honoured here as well as on /admin, through the same rule the
  // popstate handler uses. Without it, /admin/overview?tab=admins would open
  // Overview on load and Admins after a Back — one URL meaning two things.
  const [{ tab }, query] = await Promise.all([params, searchParams]);
  // Called, not nested as <AdminPanel/>: an async Server Component inside
  // another one suspends, and this repo's page tests render with
  // `renderToStaticMarkup(await Page())`, which has no Suspense boundary to
  // catch it. Awaiting here keeps both the route and the tests on one path.
  return AdminPanel({ tab: resolveAdminTab(tab, query.tab) });
}
