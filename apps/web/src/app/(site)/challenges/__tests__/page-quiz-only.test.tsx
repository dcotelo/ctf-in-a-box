// /challenges must 404 on an event that never enabled secure-development —
// not just have its nav entry disappear. The main page.test.tsx suite proves
// this with `isModuleEnabled` mocked directly; this file proves it end to
// end, through the REAL `isModuleEnabled` (from `@/lib/modules`), driven by a
// quiz-only event config.
//
// Own file because `vi.mock` hoists per file and this fixture needs its own
// event config (the shipped one enables secure-development only) — same
// split as lib/__tests__/modules-resolve.test.ts and
// app/__tests__/page-quiz-only.test.tsx.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

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

import ChallengesPage from "@/app/(site)/challenges/page";

describe("/challenges on a quiz-only event", () => {
  it("404s — the route must not be reachable even though it isn't in the nav", async () => {
    await expect(ChallengesPage()).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });
});
