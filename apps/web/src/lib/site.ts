// Central site config: event facts and primary navigation.
// Keep route copy in one place so the header, footer, and metadata stay in sync.

export const event = {
  name: "OWASP CTF @ DEF CON 34",
  theme: "Agency",
  dates: "August 7–9, 2026",
  location: "Las Vegas Convention Center",
  // Friday, August 7, 2026, 10:00 AM Pacific Daylight Time (Las Vegas).
  // ISO with explicit offset so it resolves to the same instant everywhere.
  ctfStartsAt: "2026-08-07T10:00:00-07:00",
  // Full DEF CON schedule (talks, villages, timing) lives in HackerTracker,
  // not on this site — we only own CTF-specific content.
  hackerTrackerUrl: "https://hackertracker.app",
  // Live contestant support during the event: scoring questions, stuck runs,
  // organizer announcements. Resolves to the public #general channel and never
  // expires. If this is ever reissued, check the target channel first — the
  // header, hero, rules, how-to-play, 404, and FAQ all funnel contestants here,
  // and a previous invite pointed at an organizers-only channel.
  discordUrl: "https://discord.gg/UV63TUea8d",
  // OWASP's own project: OWASP-grounded procedures an AI agent follows to do
  // security engineering work. The recommended way to point an agent at a target.
  secureAgentPlaybookUrl: "https://github.com/OWASP/secure-agent-playbook",

  // Governing policies. This site publishes short, specific notices and defers
  // to these as the authoritative documents — we don't restate them.
  owaspPrivacyUrl: "https://policy.owasp.org/operational/privacy",
  owaspCodeOfConductUrl: "https://policy.owasp.org/operational/code-of-conduct",
  // OWASP publishes no Terms of Service; the General Disclaimer is the analogue.
  owaspDisclaimerUrl: "https://policy.owasp.org/operational/general-disclaimer",
  defconCodeOfConductUrl: "https://defcon.org/html/links/dc-code-of-conduct.html",
  // The CTF team's own inbox: the one address on this site that reaches the
  // organizers rather than the Foundation or DEF CON. Use it for anything that
  // needs a private, written channel and shouldn't go in a public Discord.
  contactEmail: "defcon-ctf@owasp.org",
  // As published on the OWASP privacy policy — note .com, not .org.
  privacyContactEmail: "privacy@owasp.com",
  defconSafetyEmail: "safety@defcon.org",
  defconSafetyHotline: "725-222-0934",
} as const;

export type NavLink = { href: string; label: string };

// Order here drives the header nav left-to-right.
export const navLinks: NavLink[] = [
  { href: "/how-to-play", label: "How to Play" },
  { href: "/challenges", label: "Challenges" },
  { href: "/rules", label: "Rules" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/faq", label: "FAQ" },
];

// Policy routes. Deliberately kept out of `navLinks` — these belong in the
// footer's secondary row, not the header nav.
export const legalLinks: NavLink[] = [
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/code-of-conduct", label: "Code of Conduct" },
];
