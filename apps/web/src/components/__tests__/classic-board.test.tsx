// @testing-library/react is not a dependency of this repo and must not be
// added just for this test. ClassicBoard has no effects that run during a
// plain render, so renderToStaticMarkup is enough to check markup — same
// pattern as quiz-board.test.tsx. useRouter is mocked since next/navigation's
// real hook needs a router context. Anything gated behind a useState toggle
// (submit feedback, pending text) never appears in this static render — these
// tests only assert on the initial server-derived view.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import ClassicBoard, { type ClassicChallengeView } from "@/components/classic-board";

const web: ClassicChallengeView = {
  id: "web-sqli-101",
  title: "SQLi 101",
  category: "Web",
  description: "Find the flag hidden behind a login form.",
  points: 50,
  solveCount: 3,
  status: "unsolved",
};

const crypto: ClassicChallengeView = {
  id: "crypto-rsa-basics",
  title: "RSA Basics",
  category: "Crypto",
  description: "Break a small RSA modulus.",
  points: 75,
  solveCount: 1,
  status: "unsolved",
};

describe("ClassicBoard", () => {
  it("groups challenges under their category headings in the given order", () => {
    const html = renderToStaticMarkup(
      <ClassicBoard categories={["Web", "Crypto"]} challenges={[web, crypto]} authenticated />,
    );
    expect(html.indexOf("Web")).toBeLessThan(html.indexOf("Crypto"));
  });

  it("hides a category with no matching challenges", () => {
    const html = renderToStaticMarkup(
      <ClassicBoard categories={["Web", "Pwn"]} challenges={[web]} authenticated />,
    );
    expect(html).toContain("Web");
    expect(html).not.toContain("Pwn");
  });

  it("renders the description through the markdown renderer", () => {
    const html = renderToStaticMarkup(
      <ClassicBoard categories={["Web"]} challenges={[{ ...web, description: "**bold**" }]} authenticated />,
    );
    expect(html).toMatch(/<strong[^>]*>bold<\/strong>/);
  });

  // Simulates an accidental leak — e.g. someone spreading a raw store record
  // (which DOES carry a flag) into props instead of building the public view
  // model field by field. ClassicBoard must never echo such a field into
  // markup even if it somehow arrived here.
  it("never lets a flag reach the markup, even if props carried a leaked field", () => {
    const leaked = { ...web, flag: "CTF{leaked}", flagnorm: "ctf{leaked}" } as unknown as ClassicChallengeView;
    const html = renderToStaticMarkup(<ClassicBoard categories={["Web"]} challenges={[leaked]} authenticated />);
    expect(html).not.toContain("CTF{leaked}");
    expect(html).not.toContain("ctf{leaked}");
  });

  it("shows a solved challenge without a submit control", () => {
    const html = renderToStaticMarkup(
      <ClassicBoard categories={["Web"]} challenges={[{ ...web, status: "solved", earnedPoints: 50 }]} authenticated />,
    );
    expect(html).toMatch(/solved/i);
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<button");
  });

  // The retry instant is never printed: it renders as a live countdown that
  // starts after hydration, so the server render shows a time-free
  // placeholder. Reading a clock during render trips a hydration mismatch.
  it("shows a cooldown without leaking the raw instant", () => {
    const retryAt = "2026-08-19T12:34:56.000Z";
    const html = renderToStaticMarkup(
      <ClassicBoard categories={["Web"]} challenges={[{ ...web, status: "cooldown", retryAt }]} authenticated />,
    );
    expect(html).not.toContain(retryAt);
    expect(html).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(html).toMatch(/cooldown/i);
  });

  it("prompts a signed-out visitor to sign in instead of offering a submit control", () => {
    const html = renderToStaticMarkup(
      <ClassicBoard categories={["Web"]} challenges={[web]} authenticated={false} />,
    );
    expect(html).toMatch(/sign in with github/i);
    expect(html).not.toContain("<button");
  });

  it("shows the progress line for a signed-out visitor and for an empty board", () => {
    // Both are real regressions this kit has shipped by nesting the progress
    // line inside a `challenges.length > 0` branch.
    expect(
      renderToStaticMarkup(<ClassicBoard categories={[]} challenges={[]} authenticated={false} />),
    ).toMatch(/0 of 0/);
    expect(
      renderToStaticMarkup(<ClassicBoard categories={["Web"]} challenges={[web]} authenticated={false} />),
    ).toMatch(/0 of 1/);
  });
});
