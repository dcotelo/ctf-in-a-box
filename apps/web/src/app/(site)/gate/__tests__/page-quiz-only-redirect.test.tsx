// Where /gate sends an unlocked visitor on a QUIZ-ONLY event — the half of
// the fix that leaves no trace in the markup, checked the same way
// `page-redirect.test.tsx` checks it for secure-development.
//
// `page-quiz-only.test.tsx` renders the locked screen and asserts the markup
// carries no "/challenges". That is not the destination: `destination` is a
// GateForm PROP and never reaches the HTML, so hardcoding the redirect back to
// `/challenges` passed the whole suite while a quiz-only contestant unlocked
// the gate and landed on a 404. The redirect throws before anything renders,
// so it is pinned off the thrown NEXT_REDIRECT digest instead.
//
// The gate is deliberately left INACTIVE — one of the two conditions under
// which the page redirects instead of rendering, and the one that needs no
// cookie. It is set explicitly rather than assumed: the ACTIVE sibling suite
// stubs the same env vars.
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.CHALLENGES_GATE_ENABLED = "false";
});

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/event-config", () => ({
  eventConfig: {
    name: "Quiz Night",
    theme: "",
    dates: "",
    location: "",
    ctfStartsAt: null,
    url: "http://localhost:3000",
    contactEmail: "",
    githubOrg: "OWASP-CTF",
    discordUrl: "",
    modules: [{ id: "quiz" }],
    targets: [],
    admins: [],
  },
}));

import Gate from "@/app/(site)/gate/page";

const digest = await Gate().then(
  () => null,
  (e: { digest?: string }) => e?.digest ?? null,
);

describe("/gate on a quiz-only event", () => {
  it("redirects an unlocked visitor at all", () => {
    // `redirect()` signals by throwing; the digest carries the destination.
    expect(digest).toMatch(/^NEXT_REDIRECT/);
  });

  it("sends them to the enabled module's own route", () => {
    expect(digest).toContain("/quiz");
  });

  it("never sends them to a route this event does not have", () => {
    expect(digest).not.toContain("/challenges");
  });
});
