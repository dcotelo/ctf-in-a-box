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

import { buildNavLinks, navLinks } from "@/lib/site";

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

describe("buildNavLinks", () => {
  it("builds nav links from resolved module titles", () => {
    const links = buildNavLinks([
      { id: "quiz", nav: { href: "/quiz", label: "Quiz" }, title: "Round 1" } as never,
    ]);
    expect(links).toContainEqual({ href: "/quiz", label: "Round 1" });
  });

  it("omits modules with no nav entry", () => {
    const links = buildNavLinks([{ id: "quiz", title: "Round 1" } as never]);
    expect(links.some((l) => l.href === "/quiz")).toBe(false);
  });

  it("keeps the leading and trailing platform links in order", () => {
    const links = buildNavLinks([]);
    expect(links[0].href).toBe("/how-to-play");
    expect(links[links.length - 1].href).toBe("/faq");
  });
});
