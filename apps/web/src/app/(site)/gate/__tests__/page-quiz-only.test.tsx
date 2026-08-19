// /gate on a quiz-only event.
//
// The lock screen redirected an unlocked visitor to /challenges
// unconditionally — a hard 404 on every event without secure-development, from
// the page whose only job is letting people in. It also spoke exclusively
// about "the challenge board".
//
// The gate must be ACTIVE for the page to render at all (its redirect is the
// exact complement of the proxy's), so the env is stubbed before the module
// graph loads — `@/lib/gate` reads it once, at import.
//
// Own file for the usual `vi.mock` hoisting reason.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { findSecureDevLeaks } from "../../__tests__/secure-dev-terms";

vi.hoisted(() => {
  process.env.CHALLENGES_GATE_ENABLED = "true";
  process.env.CHALLENGES_GATE_PASSWORD = "open-sesame";
  process.env.BETTER_AUTH_SECRET = "test-secret";
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

const html = await Gate().then(renderToStaticMarkup);

describe("/gate in a quiz-only event", () => {
  it("sends an unlocked visitor to a route that exists", () => {
    // The destination is handed to the form, which navigates to it on a
    // successful unlock — and is the same value the page's own redirect uses.
    expect(html).toContain("Unlock quiz");
    expect(html).not.toContain("/challenges");
  });

  it("does not describe a challenge board this event has no notion of", () => {
    expect(html).toContain("This event is locked");
    expect(findSecureDevLeaks(html)).toEqual([]);
  });

  it("still asks for the password", () => {
    expect(html).toContain("enter access password");
    expect(html).toContain("Five wrong attempts locks this address out for 24 hours.");
  });
});
