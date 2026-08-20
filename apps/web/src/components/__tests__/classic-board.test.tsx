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

import ClassicBoard, { resultLine, type ClassicChallengeView, type Feedback } from "@/components/classic-board";

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

  // The board used to carry its own "0 of 1 solved." on top of the page's
  // "You've solved 0 of 1 challenge." — the same fact, twice, in two
  // phrasings. The page owns that line now (flags/page.test.tsx asserts it
  // renders exactly once, including on an empty board and for a signed-out
  // visitor, which is the regression the board's copy was guarding).
  it("prints no progress count of its own", () => {
    const html = renderToStaticMarkup(
      <ClassicBoard categories={["Web"]} challenges={[web]} authenticated={false} />,
    );
    expect(html).not.toMatch(/\d+ of \d+/);
  });
});

describe("resultLine", () => {
  const solved: ClassicChallengeView = { ...web, status: "solved", earnedPoints: 50 };

  it("states a solved challenge's award once, from the durable status", () => {
    expect(resultLine(solved, undefined)).toEqual({ kind: "success", text: "Solved — earned 50 points." });
    expect(resultLine({ ...solved, earnedPoints: 1 }, undefined)?.text).toBe("Solved — earned 1 point.");
  });

  // The duplicate this exists to prevent: a fresh submission's feedback and
  // the refreshed solved status both announcing the same points.
  it("returns the fresh feedback INSTEAD of the status line, never both", () => {
    const fresh: Feedback = { kind: "success", text: "Correct — +50 points." };
    expect(resultLine(solved, fresh)).toEqual(fresh);
  });

  it("has nothing to say about an unsolved challenge with no feedback", () => {
    expect(resultLine(web, undefined)).toBeNull();
  });

  it("passes a refusal or a wrong answer straight through", () => {
    const wrong: Feedback = { kind: "error", text: "Not quite. Try again." };
    expect(resultLine(web, wrong)).toEqual(wrong);
  });
});
