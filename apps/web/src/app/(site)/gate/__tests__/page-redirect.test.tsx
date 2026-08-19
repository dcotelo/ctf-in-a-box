// Where /gate sends a visitor who does not need the lock screen.
//
// This is the half of the fix that leaves no trace in the markup: the
// destination used to be a hardcoded `/challenges`, which is a hard 404 on
// every event that doesn't run secure-development. A render test cannot see it
// (the redirect throws before anything renders, and the form's destination is
// a prop, not markup), so it is pinned off the thrown NEXT_REDIRECT digest.
//
// The gate is deliberately left INACTIVE here — that is one of the two
// conditions under which the page redirects instead of rendering, and it needs
// no cookie to reach.
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/event-config", () => ({
  eventConfig: {
    name: "OWASP CTF",
    theme: "",
    dates: "",
    location: "",
    ctfStartsAt: null,
    url: "http://localhost:3000",
    contactEmail: "",
    githubOrg: "OWASP-CTF",
    discordUrl: "",
    modules: [{ id: "secure-development", targets: ["juice-shop"] }],
    targets: ["juice-shop"],
    admins: [],
  },
}));

import Gate from "@/app/(site)/gate/page";

describe("/gate on a secure-development event", () => {
  it("redirects an unlocked visitor to the module's own route, as it always did", async () => {
    // `redirect()` signals by throwing; the digest carries the destination.
    const err = await Gate().then(
      () => null,
      (e: { digest?: string }) => e,
    );
    expect(err?.digest).toContain("/challenges");
  });
});
