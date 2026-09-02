// The challenge page's interactive surface — the card, form, cooldown and
// result-line logic that moved off the board (issue #208). These are the old
// board suite's card pins, ported with the component: the states, the #126
// ordering, and the flag-leak guard follow the form wherever it lives.
//
// @testing-library/react is not a dependency of this repo and must not be
// added just for this test; renderToStaticMarkup is enough. useRouter is
// mocked since next/navigation's real hook needs a router context. Anything
// gated behind a useState toggle never appears in a static render — these
// tests assert on the initial server-derived view, and drive `feedback`
// through the ChallengeCard prop where ordering matters.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import ChallengeDetail, {
  ChallengeCard,
  describeCorrect,
  resultLine,
  type ClassicChallengeView,
  type Feedback,
} from "@/components/challenge-detail";

const web: ClassicChallengeView = {
  id: "web-sqli-101",
  title: "SQLi 101",
  category: "Web",
  description: "Find the flag hidden behind a login form.",
  points: 50,
  solveCount: 3,
  status: "unsolved",
};

describe("ChallengeDetail", () => {
  it("renders the description through the markdown renderer", () => {
    const html = renderToStaticMarkup(
      <ChallengeDetail challenge={{ ...web, description: "**bold**" }} authenticated submitPath="/api/classic/submit" />,
    );
    expect(html).toMatch(/<strong[^>]*>bold<\/strong>/);
  });

  it("shows a solved challenge without a submit control", () => {
    const html = renderToStaticMarkup(
      <ChallengeDetail challenge={{ ...web, status: "solved", earnedPoints: 50 }} authenticated submitPath="/api/classic/submit" />,
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
      <ChallengeDetail challenge={{ ...web, status: "cooldown", retryAt }} authenticated submitPath="/api/classic/submit" />,
    );
    expect(html).not.toContain(retryAt);
    expect(html).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(html).toMatch(/cooldown/i);
  });

  it("shows the case-sensitive badge only when the challenge carries it", () => {
    const on = renderToStaticMarkup(
      <ChallengeDetail challenge={{ ...web, caseSensitive: true }} authenticated submitPath="/api/classic/submit" />,
    );
    const off = renderToStaticMarkup(<ChallengeDetail challenge={web} authenticated submitPath="/api/classic/submit" />);
    expect(on).toMatch(/case-sensitive/i);
    expect(off).not.toMatch(/case-sensitive/i);
  });

  it("prompts a signed-out visitor to sign in instead of offering a submit control", () => {
    const html = renderToStaticMarkup(<ChallengeDetail challenge={web} authenticated={false} submitPath="/api/classic/submit" />);
    expect(html).toMatch(/sign in with github/i);
    expect(html).not.toContain("<button");
  });

  it("never lets a flag reach the markup, even if props carried a leaked field", () => {
    const leaked = { ...web, flag: "CTF{leaked}", flagnorm: "ctf{leaked}" } as unknown as ClassicChallengeView;
    const html = renderToStaticMarkup(<ChallengeDetail challenge={leaked} authenticated submitPath="/api/classic/submit" />);
    expect(html).not.toContain("CTF{leaked}");
    expect(html).not.toContain("ctf{leaked}");
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

describe("describeCorrect", () => {
  it("celebrates a fresh solve with its points", () => {
    expect(describeCorrect(50)).toBe("Correct — +50 points.");
    expect(describeCorrect(1)).toBe("Correct — +1 point.");
  });

  it("explains an idempotent re-submission instead of announcing +0", () => {
    expect(describeCorrect(0, true)).toBe("You already solved this one — those points are already yours.");
  });
});

// #126, mirroring quiz-board.test.tsx. The two surfaces mirror each other
// deliberately, so a fix applied to one and not the other is the regression
// — this test is what makes that true rather than aspirational.
//
// Driven through ChallengeCard with a `feedback` prop: resultLine returns
// null for a cooldown challenge until a submission produces feedback, and
// feedback is client state a static render cannot drive.
describe("outcome ordering (#126)", () => {
  it("puts the outcome before its consequence, and both above the form", () => {
    const cooling: ClassicChallengeView = {
      ...web,
      status: "cooldown",
      retryAt: "2026-08-18T12:34:56.000Z",
    };
    const html = renderToStaticMarkup(
      <ChallengeCard
        challenge={cooling}
        authenticated
        value=""
        pending={false}
        feedback={{ kind: "error", text: "Not quite." }}
        onChange={() => {}}
        onSubmit={() => {}}
      />,
    );
    const outcomeAt = html.indexOf("Not quite.");
    const cooldownAt = html.indexOf("On cooldown");
    const formAt = html.indexOf("<input");
    expect(outcomeAt).toBeGreaterThan(-1);
    expect(cooldownAt).toBeGreaterThan(-1);
    expect(formAt).toBeGreaterThan(-1);
    expect(outcomeAt).toBeLessThan(cooldownAt);
    expect(cooldownAt).toBeLessThan(formAt);
  });
});
