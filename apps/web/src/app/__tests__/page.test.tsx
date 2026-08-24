// Landing page, on the SHIPPED event config (event-config.generated.ts, which
// enables secure-development only). This file deliberately does NOT mock
// `@/lib/event-config`: it pins the composed page against the configuration
// every event has shipped so far, so a refactor that quietly drops a module's
// copy fails here first.
//
// The other fixtures — quiz-only, two-module, and a module with no home block —
// each need their own event config, and `vi.mock` hoists per FILE, so they live
// in sibling files (page-quiz-only, page-two-modules, page-no-home), the same
// split lib/__tests__/modules-resolve.test.ts uses.
//
// @testing-library/react is not a dependency here and must not be added for
// this; renderToStaticMarkup (ships with react-dom) is enough, since these
// assertions are all on markup text.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// getResolvedModules is exercised for real (it is what pairs a module's home
// block with its organizer-resolved title), so its server-side deps are
// stubbed the same way lib/__tests__/resolved-modules.test.ts stubs them:
// `server-only` throws outside an RSC build, and the real `connection()`
// throws outside a Next request store.
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/admin-store", () => ({
  getAdminSettings: async () => ({ moduleOverrides: {} }),
}));
vi.mock("@/lib/challenges", () => ({ getChallengeCatalog: async () => null }));
// layout.tsx is imported for its `metadata` export; its font loaders are
// build-time Next magic with no runtime implementation under Vitest.
vi.mock("next/font/google", () => {
  const font = () => ({ variable: "" });
  return { Archivo: font, Public_Sans: font, Geist_Mono: font };
});
vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} />
  ),
}));

import Home from "@/app/page";
import { metadata } from "@/app/layout";
import { eventConfig } from "@/lib/event-config";

const html = await Home().then(renderToStaticMarkup);

describe("landing page frame", () => {
  it("renders the event name as the headline", () => {
    expect(html).toContain(eventConfig.name);
  });

  it("keeps the platform's own CTAs and tracking section", () => {
    expect(html).toContain("How to play");
    expect(html).toContain("Live leaderboard");
    expect(html).toContain("Track your progress live");
  });
});

describe("landing page with secure-development enabled", () => {
  it("renders the module's tagline under the event name", () => {
    expect(html).toContain("Secure Development CTF");
  });

  it("renders the module's hero intro with the live target count", () => {
    expect(html).toContain(
      "Break real vulnerabilities in 6 OWASP training apps, patch them for real, and ship the fix as a GitHub pull request.",
    );
  });

  it("renders the module's CTA into its own route", () => {
    expect(html).toContain('href="/challenges"');
    expect(html).toContain("Browse targets");
  });

  // The apostrophes are U+2019, exactly as the JSX's `&rsquo;` rendered them
  // before this copy moved into the registry — renderToStaticMarkup emits the
  // literal character, not an entity. Asserting on an ASCII "'" here would
  // quietly license a copy change.
  it("renders the module's what-to-expect block", () => {
    expect(html).toContain("What to expect");
    expect(html).toContain("This isn’t flag hunting. It’s the real fix workflow");
    expect(html).toContain("prove the fix with a passing regression test");
  });

  it("renders all four steps", () => {
    for (const title of [
      "Pick a target",
      "Find the vulnerability",
      "Patch it and open a PR",
      "Get scored automatically",
    ]) {
      expect(html).toContain(title);
    }
  });

  it("renders the module's bring-your-agent section", () => {
    expect(html).toContain("Bring your agent");
    expect(html).toContain("Please use AI");
    expect(html).toContain("the skill this event exists to build");
  });

  it("renders the Secure Agent Playbook card alongside it", () => {
    expect(html).toContain("Start with the OWASP Secure Agent Playbook");
    expect(html).toContain("https://github.com/OWASP/secure-agent-playbook");
  });

  it("renders the targets grid", () => {
    expect(html).toContain("6 real targets");
    expect(html).toContain("Juice Shop");
    expect(html).toContain("VAmPI");
  });

  // One module means one section, so it keeps the generic kicker rather than
  // being labelled with its own title (which would just restate the tagline).
  it("does not head the single section with the module title", () => {
    expect(html).not.toContain(">Secure Development<");
  });
});

describe("root metadata", () => {
  it("describes the event with the enabled modules' taglines", () => {
    expect(metadata.description).toBe("OWASP CTF — Secure Development CTF.");
  });

  it("no longer hardcodes secure-development copy onto every page", () => {
    expect(metadata.description).not.toContain("patch real vulnerabilities");
  });
});
