// The leaderboard's empty state, composed from the enabled modules.
//
// The failure this pins: the copy used to be secure-development's, hard-coded
// — "Patch your first challenge", linking to /challenges — which on a
// quiz-only event tells contestants to do something the event does not
// contain, and links to a page that isn't there. The sentence and its
// destination now come from the module registry, so this renders the REAL
// copy rather than a fixture's.
//
// `vi.mock` is hoisted per file, so the event-config fixture (a two-module
// event, giving access to both modules' real registry entries) lives in its
// own file — see leaderboard-single-module.test.tsx and modules-resolve.test.ts.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...props} alt={(props.alt as string) ?? ""} />;
  },
}));
vi.mock("@/lib/event-config", () => ({
  eventConfig: {
    targets: ["dvwa"],
    modules: [
      { id: "secure-development", targets: ["dvwa"], scoreIngest: "poll" },
      { id: "quiz" },
    ],
  },
}));

import { EmptyBoard } from "@/components/leaderboard";
import { resolveModules } from "@/lib/modules";

const modules = resolveModules({});
const only = (id: string) => modules.filter((m) => m.id === id);

describe("the empty leaderboard", () => {
  it("keeps today's wording and link on a secure-development event", () => {
    const html = renderToStaticMarkup(<EmptyBoard modules={only("secure-development")} />);
    expect(html).toContain("Patch your first challenge");
    expect(html).toContain("$ pick a challenge");
    expect(html).toContain('href="/challenges"');
  });

  it("invites a quiz-only event's contestants to the quiz instead", () => {
    const html = renderToStaticMarkup(<EmptyBoard modules={only("quiz")} />);
    expect(html).toContain("Answer your first question");
    expect(html).toContain("$ answer a question");
    expect(html).toContain('href="/quiz"');
    // The whole point: neither the copy nor the link may mention challenges on
    // an event that has none.
    expect(html).not.toContain("challenge");
  });

  it("follows registry order when both modules are enabled", () => {
    // Patching is the primary way onto the board when it is on the menu at all.
    const html = renderToStaticMarkup(<EmptyBoard modules={modules} />);
    expect(html).toContain("$ pick a challenge");
    expect(html).not.toContain("$ answer a question");
  });

  it("keeps the invitation's framing whatever the module is", () => {
    for (const fixture of [only("secure-development"), only("quiz")]) {
      const html = renderToStaticMarkup(<EmptyBoard modules={fixture} />);
      expect(html).toContain("The board is wide open");
      expect(html).toContain("Every rank is unclaimed.");
    }
  });

  // A module with nothing to say about the board is valid, not an error — the
  // invitation degrades to its heading rather than to a dead link.
  it("renders no call to action when no enabled module supplies one", () => {
    const html = renderToStaticMarkup(<EmptyBoard modules={[]} />);
    expect(html).toContain("The board is wide open");
    expect(html).not.toContain("<a");
  });
});
