// The classic board as a category-grouped tile grid (issue #208): tiles are
// links to /flags/[id] carrying only title + points + solved state — the
// description and the flag form live on the challenge's own page now. Static
// renders are enough: the board is a Server Component with no interactivity.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

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

describe("ClassicBoard (tile grid)", () => {
  it("groups tiles under their category headings in the given order", () => {
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

  // The tile IS the navigation: title + points, linking to the challenge's
  // own page. No description, no form — those moved to /flags/[id].
  it("renders each challenge as a linked tile with title and points, and nothing more", () => {
    const html = renderToStaticMarkup(
      <ClassicBoard categories={["Web"]} challenges={[web]} authenticated />,
    );
    expect(html).toContain('href="/flags/web-sqli-101"');
    expect(html).toContain("SQLi 101");
    expect(html).toContain("50 pts");
    expect(html).not.toContain("Find the flag hidden behind a login form.");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("Submit flag");
  });

  it("URL-encodes a challenge id in the tile link", () => {
    const odd = { ...web, id: "web/one two" };
    const html = renderToStaticMarkup(
      <ClassicBoard categories={["Web"]} challenges={[odd]} authenticated />,
    );
    expect(html).toContain('href="/flags/web%2Fone%20two"');
  });

  // A solved tile must LOOK solved and be announced — not just exist.
  it("marks a solved tile visibly and for screen readers", () => {
    const html = renderToStaticMarkup(
      <ClassicBoard
        categories={["Web"]}
        challenges={[{ ...web, status: "solved", earnedPoints: 50 }]}
        authenticated
      />,
    );
    expect(html).toContain("border-[#22c55e]/40");
    expect(html).toContain("(solved)");
  });

  it("summarizes progress once, over the rendered set, for a signed-in viewer", () => {
    const html = renderToStaticMarkup(
      <ClassicBoard
        categories={["Web", "Crypto"]}
        challenges={[{ ...web, status: "solved", earnedPoints: 50 }, crypto]}
        authenticated
      />,
    );
    expect(html).toContain("/ 2 solved");
    expect(html).toContain("/ 125 pts");
    // A challenge in an unlisted category must not inflate the totals — the
    // CodeRabbit finding on the old rail, kept fixed on the grid.
    const withStray = renderToStaticMarkup(
      <ClassicBoard
        categories={["Web"]}
        challenges={[web, { ...crypto, category: "Hidden" }]}
        authenticated
      />,
    );
    expect(withStray).toContain("/ 1 solved");
    expect(withStray).toContain("/ 50 pts");
  });

  it("shows no personal summary to a signed-out visitor", () => {
    const html = renderToStaticMarkup(
      <ClassicBoard categories={["Web"]} challenges={[web]} authenticated={false} />,
    );
    expect(html).not.toContain("/ 1 solved");
    // Tiles stay browsable.
    expect(html).toContain("SQLi 101");
  });

  // Simulates an accidental leak — e.g. someone spreading a raw store record
  // (which DOES carry a flag) into props instead of building the public view
  // model field by field. The grid must never echo such a field into markup
  // even if it somehow arrived here.
  it("never lets a flag reach the markup, even if props carried a leaked field", () => {
    const leaked = { ...web, flag: "CTF{leaked}", flagnorm: "ctf{leaked}" } as unknown as ClassicChallengeView;
    const html = renderToStaticMarkup(<ClassicBoard categories={["Web"]} challenges={[leaked]} authenticated />);
    expect(html).not.toContain("CTF{leaked}");
    expect(html).not.toContain("ctf{leaked}");
  });
});
