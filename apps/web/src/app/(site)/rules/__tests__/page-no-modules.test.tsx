// /rules on an event whose enabled modules contribute no rules at all — the
// case a future module ships before it has written any. Fair play is
// otherwise entirely module-contributed, and without a fallback this renders
// a CTF with no anti-collusion rule and no don't-attack-the-platform rule:
// the two things every event needs regardless of what it is running.
//
// A module-free config is the simplest way to reach that state (a module with
// no `rules` block behaves identically — `getModuleRules` returns undefined
// either way).
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { findSecureDevLeaks } from "../../__tests__/secure-dev-terms";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/admin-store", () => ({
  getAdminSettings: async () => ({ moduleOverrides: {} }),
}));

vi.mock("@/lib/event-config", () => ({
  eventConfig: {
    name: "Frameless CTF",
    theme: "",
    dates: "",
    location: "",
    ctfStartsAt: null,
    url: "http://localhost:3000",
    contactEmail: "",
    githubOrg: "OWASP-CTF",
    discordUrl: "",
    modules: [],
    targets: [],
    admins: [],
  },
}));

import Rules from "@/app/(site)/rules/page";

const html = await Rules().then(renderToStaticMarkup);

describe("/rules with no module contributions", () => {
  it("still states the anti-collusion and don't-attack rules", () => {
    expect(html).toContain("Fair play");
    expect(html).toContain(
      "Submit your own work. Don&#x27;t publish full solutions for others to copy during the event.",
    );
    expect(html).toContain(
      "Do not attack the scoring pipeline, the leaderboard, or other contestants.",
    );
  });

  it("keeps the platform's other sections", () => {
    for (const heading of ["Teams", "Conduct", "Scoring &amp; prizes"]) {
      expect(html).toContain(heading);
    }
    expect(html).toContain("Organizer decisions on scoring disputes are final.");
  });

  it("names no module's game", () => {
    expect(findSecureDevLeaks(html)).toEqual([]);
  });
});
