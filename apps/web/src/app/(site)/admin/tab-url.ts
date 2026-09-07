// The admin panel's URL rules, in a module with NO "use client" directive.
//
// These three helpers are pure string functions, but WHERE they live is the
// whole point: `/admin/page.tsx` and `/admin/[tab]/page.tsx` are Server
// Components and CALL `resolveAdminTab` to pick the tab the shell opens on.
// A function exported from a "use client" module is not a function on the
// server — it is a client reference — and calling one throws
// "Attempted to call resolveAdminTab() from the server", which 500s the
// whole panel. They lived in admin-controls.tsx until that happened.
//
// So the rule this file exists to hold: anything a Server Component calls
// (rather than renders as a Component) belongs on this side of the boundary.
// admin-controls.tsx imports from here, which is the direction that works —
// a Client Component may import a server-safe module, never the reverse.

/** The canonical URL for a tab. One builder, used by the sidebar's `href`,
 *  by the pushState that follows a click, and by the tests — so the link an
 *  organizer copies and the panel they are looking at cannot disagree. */
export function adminTabHref(id: string): string {
  return `/admin/${id}`;
}

/** Which tab a URL names, given its two possible sources: the `/admin/<tab>`
 *  path segment and the `?tab=` of the older form. ONE rule, used by both
 *  routes on the server and by the popstate handler on the client — the
 *  alternative is `/admin/overview?tab=admins` opening different panels
 *  depending on whether you loaded it or navigated to it.
 *
 *  An explicit `?tab=` wins: it is the more specific of the two, and it is
 *  what an old bookmark or doc link carries. Repeated `?tab=` values are
 *  treated as absent rather than picking one — a request that says two
 *  different things has said nothing usable, and falling through to the path
 *  (or Overview) beats guessing.
 *
 *  Returns "" when neither names a tab; the caller reads that as Overview. */
export function resolveAdminTab(pathTab: string | undefined, tabQuery: string | string[] | undefined): string {
  // Counted BEFORE empties are dropped: `?tab=&tab=admins` supplied the
  // parameter twice, so it is unusable by the rule above even though only one
  // half carries a value. Filtering first would have quietly picked `admins`.
  const values = Array.isArray(tabQuery) ? tabQuery : tabQuery == null ? [] : [tabQuery];
  if (values.length === 1 && values[0]) return values[0];
  return pathTab ?? "";
}

/** `resolveAdminTab` for a browser location — what the popstate handler has.
 *  Decoding is guarded: history can hold `/admin/%`, and a throwing
 *  `decodeURIComponent` there would leave the panel out of step with the URL
 *  instead of falling back to Overview. */
export function tabFromLocation(pathname: string, search: string): string {
  const match = /^\/admin\/([^/?#]+)/.exec(pathname);
  let pathTab: string | undefined;
  if (match) {
    try {
      pathTab = decodeURIComponent(match[1]);
    } catch {
      pathTab = undefined;
    }
  }
  return resolveAdminTab(pathTab, new URLSearchParams(search).getAll("tab"));
}
