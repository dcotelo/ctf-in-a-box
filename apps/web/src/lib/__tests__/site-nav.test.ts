import { describe, expect, it, vi } from "vitest";

// Both modules enabled: secure-development (has a nav entry) and quiz
// (deliberately has none in phase 1 — no /quiz route yet).
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
  });

  it("renders no nav entry for an enabled module without a route (quiz)", () => {
    expect(navLinks.some((link) => link.href === "/quiz")).toBe(false);
  });

  it("keeps the non-module links and today's order when only secure-development has a nav entry", () => {
    expect(navLinks).toEqual([
      { href: "/how-to-play", label: "How to Play" },
      { href: "/challenges", label: "Challenges" },
      { href: "/rules", label: "Rules" },
      { href: "/leaderboard", label: "Leaderboard" },
      { href: "/faq", label: "FAQ" },
    ]);
  });
});
