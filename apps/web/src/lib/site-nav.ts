// The header/footer nav shapes and the one helper that discriminates them.
// Client-safe on purpose — `site-header.tsx` (a Client Component) needs
// `isNavGroup` as a VALUE at runtime, not just its type, and `@/lib/site`
// cannot be imported for a value from a Client Component: it transitively
// imports `enabled-modules.ts`'s `server-only`. This file must never import
// server-only code (directly or transitively) for the same reason
// `event-identity.ts` doesn't.
//
// `@/lib/site` re-exports everything here verbatim, so every existing
// consumer of `NavLink`/`NavGroup`/`NavEntry`/`isNavGroup` off `@/lib/site`
// keeps working unchanged — this is where the definitions live now, not a
// second copy of them.

export type NavLink = { href: string; label: string };

/** A grouped nav entry: one dropdown parent label with its own child links.
 *  See `buildNavGroups` (in `@/lib/site`) for when this appears instead of a
 *  plain `NavLink`. */
export type NavGroup = { label: string; items: NavLink[] };

/** One header nav slot: either a plain link or a dropdown group of them. */
export type NavEntry = NavLink | NavGroup;

/** True iff `entry` is a `NavGroup` rather than a plain `NavLink`. The two
 *  shapes don't overlap on any field, so this is a plain structural check —
 *  no discriminant tag needed. */
export function isNavGroup(entry: NavEntry): entry is NavGroup {
  return "items" in entry;
}
