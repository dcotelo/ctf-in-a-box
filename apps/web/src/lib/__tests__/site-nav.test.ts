import { describe, expect, it, vi } from "vitest";

// Both modules enabled: secure-development and quiz now both have a nav
// entry, spliced in registry order between the platform-level links.
vi.mock("@/lib/event-config", () => ({
  eventConfig: {
    targets: ["dvwa"],
    modules: [
      { id: "secure-development", targets: ["dvwa"], scoreIngest: "poll" },
      { id: "quiz" },
    ],
  },
}));

import { navLinks } from "@/lib/site";

describe("navLinks", () => {
  it("renders a nav entry for each enabled module that has one", () => {
    expect(navLinks).toContainEqual({ href: "/challenges", label: "Challenges" });
    expect(navLinks).toContainEqual({ href: "/quiz", label: "Quiz" });
  });

  it("keeps the non-module links and today's order with both modules' nav entries spliced in", () => {
    expect(navLinks).toEqual([
      { href: "/how-to-play", label: "How to Play" },
      { href: "/challenges", label: "Challenges" },
      { href: "/quiz", label: "Quiz" },
      { href: "/rules", label: "Rules" },
      { href: "/leaderboard", label: "Leaderboard" },
      { href: "/faq", label: "FAQ" },
    ]);
  });
});
