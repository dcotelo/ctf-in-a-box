// The per-module 404 boundaries (issue #175 follow-up).
//
// What these pin is the CLAIM the page makes, not its markup. A module route
// 404s for exactly one reason — this event is not running that module — and
// the root 404's "the link is just wrong or out of date" is false in that
// case. A contestant who had /flags open a minute ago has a correct link and a
// working browser; sending them to hunt for a better URL is the failure mode
// worth a test.

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/enabled-modules", () => import("@/test/enabled-modules-baked"));
// The shared body resolves live modules for its route directory; that is
// covered elsewhere, and stubbing it keeps these tests about the copy.
vi.mock("@/components/not-found-body", () => ({
  getNotFoundRoutes: async () => [],
  default: ({ title, description, eyebrow }: { title: string; description: string; eyebrow?: string }) => (
    <div>
      <span>{eyebrow}</span>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  ),
}));

import FlagsNotFound from "@/app/(site)/flags/not-found";
import QuizNotFound from "@/app/(site)/quiz/not-found";
import ChallengesNotFound from "@/app/(site)/challenges/not-found";

/** Static markup escapes apostrophes to `&#x27;`, so "doesn't" never matches a
 *  regex written the way the copy reads. Decode before asserting rather than
 *  writing entity-aware patterns, which drift the moment the copy is edited. */
const text = (html: string) => html.replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&");

const WRONG_LINK = /link is just wrong|out of date|doesn't exist/i;

describe("a switched-off module's 404", () => {
  for (const [label, Component, name] of [
    ["flags", FlagsNotFound, "Classic CTF"],
    ["quiz", QuizNotFound, "Quiz"],
  ] as const) {
    describe(label, async () => {
      const html = text(renderToStaticMarkup(await Component()));

      it("names the module, so the page says which thing is off", () => {
        expect(html).toContain(name);
      });

      it("does NOT tell the contestant their link is wrong", () => {
        // The whole point. Their link is correct; the event changed under them.
        expect(html).not.toMatch(WRONG_LINK);
      });

      it("says their existing progress is untouched", () => {
        // Disabling is a switch, not a delete — and the person most likely to
        // fear otherwise is the one staring at this page.
        expect(html).toMatch(/nothing you have already solved is affected/i);
      });

      it("says it can come back", () => {
        expect(html).toMatch(/come back/i);
      });
    });
  }
});

describe("secure-development's 404", async () => {
  // Not runtime-toggleable (ADR 52), so this route means "not part of this
  // event" rather than "switched off". Promising it can come back would leave
  // contestants waiting for something no organizer can do from the panel.
  const html = text(renderToStaticMarkup(await ChallengesNotFound()));

  it("says the event does not run it, rather than that it was switched off", () => {
    expect(html).toMatch(/doesn't run|isn't part of this event/i);
    expect(html).not.toMatch(/switched off/i);
  });

  it("does not promise it can come back mid-event", () => {
    expect(html).not.toMatch(/come back/i);
  });

  it("still absolves the visitor's link", () => {
    expect(html).toMatch(/link is fine/i);
    expect(html).not.toMatch(WRONG_LINK);
  });
});
