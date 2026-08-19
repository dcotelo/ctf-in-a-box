// /challenges names itself from the organizer's module rename — and, with no
// rename set, from its own long-standing default.
//
// The distinction is the whole point: `secure-development`'s registry display
// name is "Secure Development", but this page has always been headed
// "Challenges". Reading the resolved `title` here would have silently retitled
// the page on every event that never opened the admin panel, the same bug the
// nav had. So both directions are pinned: override wins, no override changes
// nothing.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { getResolvedModules, getChallengeCatalog, getHintAvailability } = vi.hoisted(() => ({
  getResolvedModules: vi.fn(),
  getChallengeCatalog: vi.fn(),
  getHintAvailability: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/resolved-modules", () => ({ getResolvedModules }));
vi.mock("@/lib/challenges", () => ({ getChallengeCatalog }));
vi.mock("@/lib/hint-store", () => ({
  getHintAvailability,
  HINTS_ENABLED: false,
  HINT_COST: 0,
}));

import ChallengesPage, { generateMetadata } from "@/app/(site)/challenges/page";

const resolved = (titleOverride?: string) => [
  {
    id: "secure-development",
    nav: { href: "/challenges", label: "Challenges" },
    targets: [],
    title: titleOverride ?? "Secure Development",
    titleOverride,
    blurb: "Find the vulnerability, patch it for real, ship the fix as a PR.",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  getChallengeCatalog.mockResolvedValue(null);
  getHintAvailability.mockResolvedValue({});
});

describe("/challenges with no organizer override", () => {
  beforeEach(() => getResolvedModules.mockResolvedValue(resolved()));

  it("keeps its own default page title, not the module's display name", async () => {
    expect((await generateMetadata()).title).toBe("Challenges");
  });

  it("keeps the default heading in the page body", async () => {
    const html = renderToStaticMarkup(await ChallengesPage());
    expect(html).toContain("Challenges");
    expect(html).not.toContain("Secure Development");
  });
});

describe("/challenges with an organizer override", () => {
  beforeEach(() => getResolvedModules.mockResolvedValue(resolved("Round 1")));

  it("uses the override as the metadata title", async () => {
    expect((await generateMetadata()).title).toBe("Round 1");
  });

  it("uses the override as the page heading", async () => {
    expect(renderToStaticMarkup(await ChallengesPage())).toContain("Round 1");
  });
});
