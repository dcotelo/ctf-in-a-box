// @testing-library/react is not a dependency of this repo and must not be
// added just for this test, and there is no jsdom either — see
// quiz-board.test.tsx for the same constraint on the same grounds.
// NavDropdown's real interactive contract — Arrow/Home/End movement and its
// wraparound, Escape closing AND moving focus back to the trigger, Tab
// closing, click-outside closing — all depend on a real focus() call and
// real DOM events that renderToStaticMarkup cannot produce, so NONE of that
// is exercised here. The decision half of that contract (given a key, what
// SHOULD happen) is pulled out into the DOM-free `triggerKeyAction`/
// `itemKeyAction` in `@/lib/nav-menu-keys` and is unit-tested directly there
// (`nav-menu-keys.test.ts`) — arrow wraparound at both ends, Home/End,
// Escape-refocus, Tab-close, and keys that must do nothing. What remains
// genuinely unproven is only the DOM wiring: that a real `focus()` call moves
// real focus, that a real outside click actually fires and closes the menu.
//
// This file is limited to what a plain, closed-by-default static render can
// show: the trigger's ARIA wiring and that the menu's items are not exposed
// until it opens (anything behind the `open` useState toggle never appears
// in a static render).
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import NavDropdown from "@/components/nav-dropdown";

const items = [
  { href: "/challenges", label: "Secure Development" },
  { href: "/quiz", label: "Quiz" },
];

describe("NavDropdown", () => {
  it("renders a closed trigger with the required WAI-ARIA menu button wiring", () => {
    const html = renderToStaticMarkup(
      <NavDropdown label="Challenges" items={items} isActive={() => false} />,
    );
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Challenges");
  });

  it("does not expose the menu or its items until opened", () => {
    const html = renderToStaticMarkup(
      <NavDropdown label="Challenges" items={items} isActive={() => false} />,
    );
    expect(html).not.toContain('role="menu"');
    expect(html).not.toContain("/challenges");
    expect(html).not.toContain("/quiz");
  });

  it("gives the trigger the active treatment when the current page is one of its items", () => {
    const inactive = renderToStaticMarkup(
      <NavDropdown label="Challenges" items={items} isActive={() => false} />,
    );
    const active = renderToStaticMarkup(
      <NavDropdown label="Challenges" items={items} isActive={(href) => href === "/quiz"} />,
    );
    expect(active).toMatch(/bg-white\/\[0\.06\]/);
    expect(inactive).not.toMatch(/bg-white\/\[0\.06\]/);
  });
});
