// Privacy notice for this site specifically. The OWASP Foundation privacy
// policy is the governing document; this page exists because it can't describe
// what a one-off CTF site does with GitHub logins, hint purchases, and gate
// rate-limiting data.
//
// IMPORTANT: every claim here is a promise about code in this repo. If you
// change what is stored, what a cookie holds, or how long anything is kept,
// change this page in the SAME PR. Sources for the claims below:
//   src/lib/auth.ts .................. sessions, OAuth scopes, no token storage
//   src/lib/gate.ts .................. gate cookie
//   src/lib/dynamo-gate-store.ts ..... gate IP throttle + 30-day TTL
//   src/lib/dynamo-stats.ts .......... aggregate country counters
//   src/lib/hint-store.ts ............ hint purchases
//   src/lib/team-store.ts ............ team membership
//   src/lib/dynamo-shapes.ts ......... every item shape in one place
//
// Tone note: this page reads as reassuring because the underlying design
// genuinely is careful — not the other way round. Don't add warmth here that
// the code doesn't earn.

import type { Metadata } from "next";
import Link from "next/link";
import PageHeader from "@/components/page-header";
import { event } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    `What the ${event.name} site collects, where it's stored, who can see it, and how to ask for it to be deleted.`,
};

const ExternalLink = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className="ds-link">
    {children}
  </a>
);

const Card = ({ heading, children }: { heading: string; children: React.ReactNode }) => (
  <section className="rounded-lg border border-white/[0.06] bg-[#16162a] p-6">
    <h2 className="mb-4 text-lg font-semibold text-white">{heading}</h2>
    {children}
  </section>
);

const Bullets = ({ items, accent = "#2563eb" }: { items: React.ReactNode[]; accent?: string }) => (
  <ul className="flex flex-col gap-3">
    {items.map((item, i) => (
      <li key={i} className="flex gap-3 text-sm leading-relaxed text-zinc-400">
        <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full" style={{ background: accent }} />
        <span>{item}</span>
      </li>
    ))}
  </ul>
);

// The strongest thing this page can say is what never happens at all. Every
// line here is enforced by code, not policy — check before adding to it.
const NEVER = [
  "No advertising, no tracking pixels, no third-party analytics, no data broker. Nothing about you is sold or shared.",
  "No consent banner, because there is nothing to consent to. Every cookie we set is doing a job you asked for.",
  "Your email address and your real name are never written to our databases and never appear anywhere on this site.",
  "We never ask GitHub for write access. We cannot push code, open pull requests, change your repositories, or act as you.",
  "We don't keep the GitHub access token issued at sign-in, so there is no key to your GitHub account sitting in our systems.",
  "We don't build a location history. The only geographic data we hold is a per-country tally with nobody's name on it.",
];

const cookies: { name: string; what: string; life: string }[] = [
  {
    name: "Sign-in session",
    what: "Set when you sign in with GitHub, and holds your session. Encrypted, and readable only by the server. Your browser can't read it, and neither can any script on the page.",
    life: "7 days",
  },
  {
    name: "Sign-in handshake",
    what: "Protects the GitHub sign-in redirect against tampering. Discarded the moment sign-in finishes.",
    life: "10 minutes",
  },
  {
    name: "ctf-challenges-gate",
    what: "Remembers that the challenge-board password was entered correctly. Holds an expiry timestamp and a signature. Nothing about you.",
    life: "30 days",
  },
  {
    name: "ctf-mock-team",
    what: "Only in the pre-event demo mode, to remember a team choice locally when nothing is being written server-side.",
    life: "30 days",
  },
];

export default function PrivacyPage() {
  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        eyebrow="Privacy"
        title="Privacy notice"
        description="A security event should be able to explain exactly what it does with your data. This page does that: written against the code, in plain language, with the awkward parts left in."
      />

      <section className="rounded-lg border border-[#22c55e]/25 bg-[#22c55e]/[0.05] p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">What we never do</h2>
        <Bullets items={NEVER} accent="#22c55e" />
      </section>

      <section className="rounded-lg border border-white/[0.06] bg-[#16162a] p-6">
        <p className="text-sm leading-relaxed text-zinc-400">
          The OWASP Foundation&apos;s{" "}
          <ExternalLink href={event.owaspPrivacyUrl}>Privacy Policy</ExternalLink> is the
          governing document and covers OWASP as a whole. This page is narrower and more
          specific: it describes what{" "}
          <span className="text-white">this competition site</span>{" "}
          does, because a general policy can&apos;t tell you what happens to a hint purchase or
          a GitHub login on a leaderboard.
        </p>
      </section>

      <Card heading="Most of this site needs nothing from you">
        <Bullets
          items={[
            "Browsing the challenges, the leaderboard, the rules, and these policy pages requires no account and no sign-in. Nothing personal is collected while you read.",
            "Sign in only if you want to claim your row on the leaderboard, see your own per-challenge breakdown, join a team, or reveal a hint. Working through the challenges without ever signing in is a perfectly valid way to use this event.",
          ]}
        />
      </Card>

      <Card heading="Signing in with GitHub">
        <p className="mb-4 text-sm leading-relaxed text-zinc-400">
          We use GitHub OAuth and ask for the two narrowest scopes available:{" "}
          <span className="font-mono text-xs text-zinc-200">read:user</span> and{" "}
          <span className="font-mono text-xs text-zinc-200">user:email</span>. Both are
          read-only.
        </p>
        <Bullets
          items={[
            <>
              GitHub hands us your <span className="text-white">login</span>, numeric account
              id, display name, avatar URL, and email address.
            </>,
            <>
              Of those we keep exactly one: your{" "}
              <span className="text-white">GitHub login</span>, because the scorer credits
              points to the account that authored a pull request. The rest renders the page
              you&apos;re on and is then forgotten.
            </>,
            <>
              We deliberately{" "}
              <span className="text-white">do not store the access token</span>{" "}
              GitHub issues at sign-in. This app never calls the GitHub API, so keeping that
              token would mean holding a credential we have no use for.
            </>,
            "There is no account database. Your session lives entirely in an encrypted cookie, so once it expires the sign-in has left nothing behind on our side.",
          ]}
        />
      </Card>

      <Card heading="What we store while you compete">
        <Bullets
          items={[
            <>
              <span className="text-white">Team membership</span>: the team&apos;s name, who
              created it, and the GitHub logins of its members.
            </>,
            <>
              <span className="text-white">Hint purchases</span>: which hints you revealed,
              when, and the running point penalty against your login.
            </>,
            <>
              <span className="text-white">Your scores</span>{" "}
              come from the scoring pipeline, keyed to the GitHub login that authored the pull
              request. This site reads them; it doesn&apos;t create them.
            </>,
          ]}
        />
        <p className="mt-4 text-sm leading-relaxed text-zinc-400">
          All of it is keyed to a public GitHub username and nothing more: no email, no real
          name, no device or location data. It lives in an AWS DynamoDB table and an Upstash
          Redis instance run for this event. Being straight with you: this competition data has
          no automatic expiry today, so treat it as kept until the organizers clear it down
          after the event. You can ask for yours sooner. See below.
        </p>
      </Card>

      <Card heading="Protecting the challenge board">
        <p className="text-sm leading-relaxed text-zinc-400">
          Before the board opens it sits behind a password, and to stop that password being
          brute forced we count failed attempts per IP address: five wrong tries locks that
          address for 24 hours. So a failed attempt writes down an{" "}
          <span className="text-white">IP address</span>, a counter, and a timestamp, the one
          place on this site where an IP address is stored at all.
        </p>
        <p className="mt-4 text-sm leading-relaxed text-zinc-400">
          We keep that as tight as we can. The record is deleted the moment a correct password
          is entered from that address, and anything left over expires automatically after{" "}
          <span className="text-white">30 days</span>. It is never linked to your GitHub
          account. The gate runs before anyone signs in, so there is no identity to attach it
          to even if we wanted one. One caveat worth knowing on conference Wi-Fi: an IP address
          can cover a lot of people, so a lockout may not have been caused by you.
        </p>
      </Card>

      <Card heading="Counting where the event reached">
        <p className="text-sm leading-relaxed text-zinc-400">
          We&apos;d like to be able to say which countries the CTF reached. So once per browser
          session, one number goes up: a tally against a{" "}
          <span className="text-white">country code</span>, and nothing else. No login, no IP
          address (not even a hashed or obfuscated one), no timestamp, no session id, nothing
          that could be traced back to a person or joined against anything else we hold.
        </p>
        <p className="mt-4 text-sm leading-relaxed text-zinc-400">
          The country is worked out by our host from the connection and handed to us already
          reduced to a two-letter code; we never see or record the address behind it. What we
          end up with is a list that reads{" "}
          <span className="font-mono text-xs text-zinc-200">US 412 · DE 88 · JP 40</span>, a
          rough measure of reach rather than a headcount, and not personal data.
        </p>
      </Card>

      <Card heading="Cookies">
        <p className="mb-4 text-sm leading-relaxed text-zinc-400">
          Four, all strictly functional, all marked{" "}
          <span className="font-mono text-xs text-zinc-200">httpOnly</span> so no script on the
          page can read them. None of them track you, and none follow you off this site.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <thead>
              <tr className="border-b border-white/[0.06]">
                <th className="pb-2 pr-4 font-semibold text-white">Cookie</th>
                <th className="pb-2 pr-4 font-semibold text-white">What it&apos;s for</th>
                <th className="pb-2 font-semibold text-white">Lifetime</th>
              </tr>
            </thead>
            <tbody>
              {cookies.map((c) => (
                <tr key={c.name} className="border-b border-white/[0.06] last:border-0">
                  <td className="py-3 pr-4 align-top font-mono text-xs text-zinc-200">
                    {c.name}
                  </td>
                  <td className="py-3 pr-4 align-top leading-relaxed text-zinc-400">{c.what}</td>
                  <td className="py-3 align-top whitespace-nowrap text-muted">{c.life}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card heading="What other people can see">
        <p className="mb-4 text-sm leading-relaxed text-zinc-400">
          The leaderboard is public (that&apos;s rather the point of a leaderboard), so
          it&apos;s worth being precise about where the line falls. Public:
        </p>
        <Bullets
          items={[
            "Your GitHub login and avatar, your rank, your points, and how many challenges you have patched and not patched.",
            "Your team, if you're on one. Expanding a team shows every member's login and avatar.",
            "The total point penalty from hints you've revealed. Which specific hints you bought stays private.",
            "For some scoring modes, the number of your most recent pull request and a short commit hash.",
          ]}
        />
        <p className="mt-4 text-sm leading-relaxed text-zinc-400">
          Not public, and not visible to other contestants or to organizers browsing the site:
          your email address, your real name, and the contents of any hint you&apos;ve revealed.
          Those appear only on your own profile page, behind your own session.
        </p>
      </Card>

      <Card heading="Who else is involved">
        <Bullets
          items={[
            <>
              <span className="text-white">GitHub</span>: handles sign-in, hosts the challenge
              repositories, and serves avatar images. Worth knowing: avatars load straight from
              GitHub, so GitHub sees the IP of anyone viewing a page with avatars on it,
              including the leaderboard.
            </>,
            <>
              <span className="text-white">Vercel</span>: hosts this site, so it processes
              requests and keeps standard server logs. We also use Vercel Web Analytics, which
              records which page was viewed. It sets no cookie, and we send it no identifiers,
              so it cannot tell who you are.
            </>,
            <>
              <span className="text-white">AWS and Upstash</span>: store the competition data
              described above. AWS is reached with short-lived credentials rather than stored
              keys.
            </>,
            ...(event.discordUrl
              ? [
                  <>
                    <span className="text-white">Discord</span>: only ever a link from this
                    site. If you join, Discord&apos;s own privacy policy governs what happens
                    there.
                  </>,
                ]
              : []),
          ]}
        />
        <p className="mt-4 text-sm leading-relaxed text-zinc-400">
          Nothing is sold, nothing is used for advertising, and nothing is shared beyond the
          services above that make the event run. Our stores are backed up as a matter of
          routine, so a deleted record can persist in a backup for a short period before ageing
          out.
        </p>
      </Card>

      <Card heading="Your choices, and how to reach a human">
        <Bullets
          items={[
            "Don't sign in. Everything except your own profile, teams, and hints works signed out.",
            "Leave your team at any time from your profile. That removes your login from the team record immediately.",
            "Clear your cookies, or just wait for them to expire, to end the session.",
          ]}
        />
        <p className="mt-4 text-sm leading-relaxed text-zinc-400">
          There is no self-serve delete button for competition data, so those requests go to a
          person. For access, correction, or deletion, contact OWASP at{" "}
          <a href={`mailto:${event.privacyContactEmail}`} className="ds-link font-mono">
            {event.privacyContactEmail}
          </a>
          , the address published in the{" "}
          <ExternalLink href={event.owaspPrivacyUrl}>OWASP Privacy Policy</ExternalLink>,
          which also sets out the rights available to you, including the additional rights of
          EEA and California residents.
          {(event.contactEmail || event.discordUrl) && (
            <>
              {" "}For CTF-specific data such as team membership or hint purchases,{" "}
              {event.contactEmail && (
                <>
                  email the organizers at{" "}
                  <a href={`mailto:${event.contactEmail}`} className="ds-link font-mono">
                    {event.contactEmail}
                  </a>
                  {event.discordUrl ? ", or " : "."}
                </>
              )}
              {event.discordUrl && (
                <>
                  ask an organizer in the{" "}
                  <ExternalLink href={event.discordUrl}>CTF Discord</ExternalLink> if you want it
                  dealt with faster. You never have to join Discord to exercise a right over your
                  own data.
                </>
              )}
            </>
          )}{" "}
          One honest caveat: removing your scores from the leaderboard means withdrawing from
          the competition.
        </p>
      </Card>

      <p className="text-sm leading-relaxed text-muted">
        See also the{" "}
        <Link href="/terms" className="ds-link">
          terms
        </Link>{" "}
        and the{" "}
        <Link href="/code-of-conduct" className="ds-link">
          code of conduct
        </Link>
        .
      </p>
    </div>
  );
}
