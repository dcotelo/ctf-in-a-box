// Central site config: event facts and primary navigation.
// Keep route copy in one place so the header, footer, and metadata stay in sync.

import { eventConfig } from "@/lib/event-config";
import { enabledModules, SECURE_AGENT_PLAYBOOK_URL } from "@/lib/modules";

export const event = {
  name: eventConfig.name,
  theme: eventConfig.theme,
  dates: eventConfig.dates,
  location: eventConfig.location,
  ctfStartsAt: eventConfig.ctfStartsAt,
  url: eventConfig.url,

  // Live contestant support during the event: scoring questions, stuck runs,
  // organizer announcements. Sourced from event.yaml's event.discord (or
  // EVENT_DISCORD) — the header, hero, rules, how-to-play, 404, and FAQ all
  // funnel contestants here. "" (unset in event config, the default) means
  // pages hide their Discord links and mentions entirely, same pattern as
  // contactEmail below.
  discordUrl: eventConfig.discordUrl,
  // OWASP's own project: OWASP-grounded procedures an AI agent follows to do
  // security engineering work. The recommended way to point an agent at a target.
  // Defined in `modules.ts` (secure-development's registry copy links to it,
  // and that file cannot import this one without a cycle) and re-exported
  // here so pages keep reading it off `event`, as they always have.
  secureAgentPlaybookUrl: SECURE_AGENT_PLAYBOOK_URL,

  // Governing policies. This site publishes short, specific notices and defers
  // to these as the authoritative documents — we don't restate them.
  owaspPrivacyUrl: "https://policy.owasp.org/operational/privacy",
  owaspCodeOfConductUrl: "https://policy.owasp.org/operational/code-of-conduct",
  // OWASP publishes no Terms of Service; the General Disclaimer is the analogue.
  owaspDisclaimerUrl: "https://policy.owasp.org/operational/general-disclaimer",
  // The CTF team's own inbox: the one address on this site that reaches the
  // organizers rather than the Foundation. Use it for anything that
  // needs a private, written channel and shouldn't go in a public Discord.
  // "" (unset in event config) means pages hide their contact-email lines.
  contactEmail: eventConfig.contactEmail,
  // As published on the OWASP privacy policy — note .com, not .org.
  privacyContactEmail: "privacy@owasp.com",
} as const;

export type NavLink = { href: string; label: string };

/** A grouped nav entry: one dropdown parent label with its own child links.
 *  See `buildNavGroups` for when this appears instead of a flat `NavLink`. */
export type NavGroup = { label: string; items: NavLink[] };

/** One header nav slot: either a plain link or a dropdown group of them. */
export type NavEntry = NavLink | NavGroup;

/** True iff `entry` is a `NavGroup` rather than a plain `NavLink`. The two
 *  shapes don't overlap on any field, so this is a plain structural check —
 *  no discriminant tag needed. */
export function isNavGroup(entry: NavEntry): entry is NavGroup {
  return "items" in entry;
}

// Platform-level pages that exist regardless of which modules are enabled.
// Module-owned entries (e.g. Challenges) are NOT listed here — they're
// spliced in from the module registry below, so a module's nav entry
// appears if and only if that module is enabled (module contract §5.4).
const leadingNavLinks: NavLink[] = [{ href: "/how-to-play", label: "How to Play" }];
const trailingNavLinks: NavLink[] = [
  { href: "/rules", label: "Rules" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/faq", label: "FAQ" },
];

// Module-owned nav entries, in registry order, filtered to modules that
// actually have a contestant route — a module gets no entry only if the
// registry omits `nav` for it (see modules.ts).
const moduleNavLinks: NavLink[] = enabledModules
  .filter((m) => m.nav)
  .map((m) => m.nav as NavLink);

// Order here drives the header nav left-to-right.
export const navLinks: NavLink[] = [...leadingNavLinks, ...moduleNavLinks, ...trailingNavLinks];

/** Pure builder for the resolved-module nav: same platform link order as
 *  `navLinks` above, but with each module link's label replaced by the
 *  organizer's EXPLICIT rename when there is one — see resolved-modules.ts
 *  for where the modules come from. A module with no `nav` entry contributes
 *  nothing. Pure — no I/O — so it's testable on its own with plain object
 *  literals, independent of the module registry.
 *
 *  `titleOverride`, deliberately, not `title`: `title` is always set (it
 *  falls back to the registry `displayName`), so reading it here renamed the
 *  nav on every event that had never touched the admin panel —
 *  secure-development's nav label is "Challenges" but its display name is
 *  "Secure Development". With no override the registry's own nav label
 *  stands, unchanged; with one, the organizer's name wins. */
export function buildNavLinks(
  modules: readonly { nav?: NavLink; titleOverride?: string }[],
): NavLink[] {
  const moduleLinks = modules
    .filter((m) => m.nav)
    .map((m) => ({ href: m.nav!.href, label: m.titleOverride || m.nav!.label }));
  return [...leadingNavLinks, ...moduleLinks, ...trailingNavLinks];
}

/** Same platform link order as `buildNavLinks`, but collapses module nav
 *  entries into a single "Challenges" dropdown once there are two or more of
 *  them — a fourth module would otherwise mean a fourth top-level header
 *  entry. Pure — no I/O — for the same reason `buildNavLinks` is.
 *
 *  - **2+ modules with a nav entry**: one `NavGroup` labelled the literal
 *    string "Challenges", whose items carry each module's `title` (the
 *    organizer's override, or the registry `displayName`) — NOT its
 *    `nav.label`. `nav.label` names the destination PAGE ("Challenges"); a
 *    dropdown called "Challenges" containing an item also called "Challenges"
 *    is nonsense, so the child must read the module's own name instead. An
 *    organizer rename still flows in: with an override, `title` IS it.
 *  - **Exactly 1 module**: falls back to `buildNavLinks` verbatim — a plain
 *    `NavLink` labelled `titleOverride || nav.label`, byte-for-byte the same
 *    single-module header this kit has always rendered. Reading `title` here
 *    instead is the accidental-rename bug `buildNavLinks` itself guards
 *    against (see its own doc comment) — don't reintroduce it by routing the
 *    1-module case through the grouped label instead.
 *  - **0 modules**: contributes nothing, same as `buildNavLinks`. */
export function buildNavGroups(
  modules: readonly { nav?: NavLink; title: string; titleOverride?: string }[],
): NavEntry[] {
  const withNav = modules.filter(
    (m): m is typeof m & { nav: NavLink } => m.nav !== undefined,
  );
  if (withNav.length < 2) {
    return buildNavLinks(modules);
  }
  const group: NavGroup = {
    label: "Challenges",
    items: withNav.map((m) => ({ href: m.nav.href, label: m.title })),
  };
  return [...leadingNavLinks, group, ...trailingNavLinks];
}

// Policy routes. Deliberately kept out of `navLinks` — these belong in the
// footer's secondary row, not the header nav.
export const legalLinks: NavLink[] = [
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/code-of-conduct", label: "Code of Conduct" },
];
