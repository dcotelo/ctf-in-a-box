"use client";

// The landing page's GitHub OAuth callback error banner (issue #380).
//
// GitHub redirects an authorize failure straight back to the app with
// `?error=<code>&error_description=<text>` — a suspended/deleted OAuth app,
// a contestant who cancelled the GitHub prompt, or a redirect URI GitHub
// doesn't recognize. Before this, the landing page read neither parameter:
// the sign-in button looked like it simply did nothing.
//
// Reuses the mock-data/hint notice's amber `ds-card` look (server-only
// components) but as `role="alert"`, since this is something that JUST
// happened on this exact page load, not page furniture present from every
// first paint — the opposite of teamless-notice's reasoning for skipping it.

import { authClient } from "@/lib/auth-client";
import { postSigninCallbackURL } from "@/lib/post-signin";

const MAX_DESCRIPTION_LENGTH = 300;

/** Friendly, human sentences for the callback errors worth naming — GitHub's
 *  own `error_description` for these is written for a developer, not a
 *  contestant. Anything else falls back to the raw (sanitized) description. */
const FRIENDLY_COPY: Record<string, string> = {
  application_suspended:
    "This event's GitHub sign-in app has been suspended, so sign-in can't complete right now. Let an organizer know.",
  access_denied:
    "Sign-in was cancelled before GitHub confirmed your identity — nothing was created or changed.",
  redirect_uri_mismatch:
    "GitHub's sign-in configuration doesn't match this site yet, so it refused the request. Let an organizer know.",
};

/** Strips ASCII control characters and caps the length. The input is a raw
 *  query parameter GitHub set — React escapes it for display either way, but
 *  a value with embedded control characters or unbounded length has no
 *  business rendering as prose. */
function sanitizeDescription(raw: string): string {
  let out = "";
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x20 && code !== 0x7f) out += ch;
  }
  return out.length > MAX_DESCRIPTION_LENGTH ? `${out.slice(0, MAX_DESCRIPTION_LENGTH)}…` : out;
}

export default function OAuthErrorNotice({
  error,
  description,
}: {
  error: string;
  description?: string;
}) {
  // `error` is an attacker-controlled query parameter. FRIENDLY_COPY is a
  // plain object literal, so `FRIENDLY_COPY[error]` for `error=constructor`
  // (or `__proto__`, `toString`, `valueOf`, `hasOwnProperty`, …) resolves to
  // an inherited Object.prototype member instead of `undefined` — truthy, so
  // `??` never falls back, and `{message}` below would be a function/object,
  // which React refuses to render as a child (an unauthenticated 500 on `/`
  // from a crafted URL). `Object.hasOwn` only ever answers from the object's
  // OWN keys, never the prototype chain.
  const message = Object.hasOwn(FRIENDLY_COPY, error)
    ? FRIENDLY_COPY[error]
    : description
      ? sanitizeDescription(description)
      : "GitHub sign-in did not complete.";
  return (
    <div
      role="alert"
      className="ds-card w-full max-w-xl rounded-lg border border-[#d4a017]/30 bg-[#d4a017]/[0.06] p-5"
    >
      <p className="text-xs font-medium uppercase tracking-wider text-[#d4a017]">Sign-in didn&rsquo;t complete</p>
      <p className="mt-1 text-sm leading-relaxed text-zinc-300">{message}</p>
      <button
        type="button"
        className="ds-link mt-2 text-sm"
        onClick={() => {
          // The same action the header's own sign-in button runs (auth-nav.tsx),
          // with an explicit errorCallbackURL so a repeat failure round-trips
          // back here instead of better-auth's default (a route this app
          // doesn't have a page for).
          void authClient.signIn.social({
            provider: "github",
            callbackURL: postSigninCallbackURL("/profile"),
            errorCallbackURL: "/",
          });
        }}
      >
        Try again
      </button>
    </div>
  );
}
