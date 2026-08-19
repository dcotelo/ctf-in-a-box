// Central site config: event facts and primary navigation.
// Keep route copy in one place so the header, footer, and metadata stay in sync.

import { eventConfig } from "@/lib/event-config";
import { enabledModules } from "@/lib/modules";

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
  secureAgentPlaybookUrl: "https://github.com/OWASP/secure-agent-playbook",

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

// Policy routes. Deliberately kept out of `navLinks` — these belong in the
// footer's secondary row, not the header nav.
export const legalLinks: NavLink[] = [
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/code-of-conduct", label: "Code of Conduct" },
];
