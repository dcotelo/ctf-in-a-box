// `/admin` — the panel's entry point, and the home of the original
// `?tab=<id>` deep link. The panel itself lives in admin-panel.tsx, shared
// with `/admin/<tab>`; this file only decides which tab that shell opens on.

import type { Metadata } from "next";
import AdminPanel from "@/app/(site)/admin/admin-panel";

export const metadata: Metadata = {
  title: "Admin",
  description: "Organizer controls and sync status.",
};

/** Which tab to open on arrival, from `?tab=<module id>`.
 *
 *  The sidebar links to `/admin/<tab>` now, so this form is what older
 *  bookmarks, docs and runbooks carry. It keeps working: both shapes hand the
 *  same string to the same shell.
 *
 *  Read here rather than from `location.hash` in the tab shell: a hash is
 *  invisible to the server, so selecting from it means a post-hydration
 *  `setState` — a render the organizer sees flip, and a lint rule this repo
 *  takes seriously. A query param is on the request, so the very first
 *  server render already has the right panel open.
 *
 *  Unvalidated here on purpose: `AdminControls` owns the tab list, so it is
 *  the only thing that can say whether an id is real, and it falls back to
 *  Overview for anything it doesn't recognise. A link to a module that this
 *  event didn't enable lands on Overview rather than on nothing. */
function tabParam(searchParams: Record<string, string | string[] | undefined>): string | undefined {
  const tab = searchParams.tab;
  return typeof tab === "string" ? tab : undefined;
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Called, not nested as <AdminPanel/>: an async Server Component inside
  // another one suspends, and this repo's page tests render with
  // `renderToStaticMarkup(await Page())`, which has no Suspense boundary to
  // catch it. Awaiting here keeps both the route and the tests on one path.
  return AdminPanel({ tab: tabParam(await searchParams) });
}
