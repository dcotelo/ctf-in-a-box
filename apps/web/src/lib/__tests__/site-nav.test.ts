import { describe, expect, it, vi } from "vitest";

// buildNavLinks is pure and takes its modules as a plain argument.
// site.ts now also imports @/lib/enabled-modules (for getSite()), which
// carries `import "server-only"` — a no-op in Next's RSC bundling but a hard
// throw in plain vitest. Stub it out; none of these tests touch getSite().
vi.mock("@/lib/enabled-modules", () => ({ getAdminSettingsSnapshot: vi.fn(async () => null) }));

import { buildNavLinks } from "@/lib/site";

describe("buildNavLinks", () => {
  // The regression gate for the rename-by-accident bug. `resolveModules`
  // ALWAYS sets `title` (it defaults to the registry `displayName`), so a
  // builder reading `m.title || m.nav.label` never reaches the fallback: it
  // relabelled secure-development's nav from "Challenges" to "Secure
  // Development" on every event that had never opened the admin panel. The
  // nav label describes the DESTINATION PAGE; the display name names the
  // MODULE. With no override, the registry's own label must survive verbatim.
  it("keeps the registry nav label when the organizer has set no override", () => {
    const links = buildNavLinks([
      {
        id: "secure-development",
        nav: { href: "/challenges", label: "Challenges" },
        title: "Secure Development",
        titleOverride: undefined,
      } as never,
    ]);
    expect(links).toContainEqual({ href: "/challenges", label: "Challenges" });
    expect(links.some((l) => l.label === "Secure Development")).toBe(false);
  });

  it("uses the organizer's override as the nav label when one is set", () => {
    const links = buildNavLinks([
      {
        id: "quiz",
        nav: { href: "/quiz", label: "Quiz" },
        title: "Round 1",
        titleOverride: "Round 1",
      } as never,
    ]);
    expect(links).toContainEqual({ href: "/quiz", label: "Round 1" });
  });

  it("omits modules with no nav entry", () => {
    const links = buildNavLinks([{ id: "quiz", titleOverride: "Round 1" } as never]);
    expect(links.some((l) => l.href === "/quiz")).toBe(false);
  });

  it("keeps the leading and trailing platform links in order", () => {
    const links = buildNavLinks([]);
    expect(links[0].href).toBe("/how-to-play");
    expect(links[links.length - 1].href).toBe("/faq");
  });
});
