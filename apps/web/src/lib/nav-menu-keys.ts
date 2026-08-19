// Pure, DOM-free decision logic for the header's "Challenges" dropdown
// (components/nav-dropdown.tsx), kept separate for the same reason
// lib/countdown.ts keeps getRemaining/formatCompact out of the component:
// this repo has no jsdom/@testing-library, so anything that needs a real
// focus() call or a real event object cannot be exercised in a test here.
// Extracting "given this key, what should happen" into ordinary functions
// makes the WAI-ARIA menu button's keyboard contract — Arrow movement with
// wraparound, Home/End, Escape-and-refocus, Tab-closes — testable directly,
// with the component left as a thin binding of these decisions to real DOM
// calls (focus(), setOpen, preventDefault).

/** What a keypress should do. `nav-dropdown.tsx` is the only thing that
 *  interprets these — everything here is inert data. */
export type MenuKeyAction =
  | { type: "open"; focusIndex: number }
  | { type: "focus"; index: number }
  | { type: "close" }
  | { type: "close-refocus-trigger" }
  | { type: "none" };

const NONE: MenuKeyAction = { type: "none" };

/** Wraps `index` into `[0, count)`, looping past either end — ArrowDown at
 *  the last item goes to the first, ArrowUp at the first goes to the last.
 *  `count` is assumed > 0 (a dropdown is never rendered with zero items). */
export function wrapIndex(index: number, count: number): number {
  return ((index % count) + count) % count;
}

/** Key pressed on the closed/open TRIGGER button. Enter and Space are
 *  deliberately not handled here: they fire the button's native click
 *  activation, which nav-dropdown.tsx's onClick handles directly (opening to
 *  the first item), so routing them through this function too would just be
 *  a second, redundant path to the same decision. */
export function triggerKeyAction(key: string, itemCount: number): MenuKeyAction {
  if (key === "ArrowDown") return { type: "open", focusIndex: 0 };
  if (key === "ArrowUp") return { type: "open", focusIndex: wrapIndex(-1, itemCount) };
  if (key === "Escape") return { type: "close" };
  return NONE;
}

/** Key pressed on an open menu ITEM at `index`, one of `itemCount` items.
 *  ArrowDown/ArrowUp wrap at both ends; Home/End jump to the first/last;
 *  Escape closes the menu AND returns focus to the trigger (unlike the
 *  trigger's own Escape, which only needs to close — focus is already
 *  there); Tab closes without moving focus, since Tab is about to move it
 *  natively; anything else is a no-op. */
export function itemKeyAction(key: string, index: number, itemCount: number): MenuKeyAction {
  if (key === "ArrowDown") return { type: "focus", index: wrapIndex(index + 1, itemCount) };
  if (key === "ArrowUp") return { type: "focus", index: wrapIndex(index - 1, itemCount) };
  if (key === "Home") return { type: "focus", index: 0 };
  if (key === "End") return { type: "focus", index: itemCount - 1 };
  if (key === "Escape") return { type: "close-refocus-trigger" };
  if (key === "Tab") return { type: "close" };
  return NONE;
}
