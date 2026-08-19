import { describe, expect, it } from "vitest";
import { itemKeyAction, triggerKeyAction, wrapIndex } from "@/lib/nav-menu-keys";

describe("wrapIndex", () => {
  it("wraps past the last index back to the first", () => {
    expect(wrapIndex(3, 3)).toBe(0);
  });

  it("wraps past the first index back to the last", () => {
    expect(wrapIndex(-1, 3)).toBe(2);
  });

  it("leaves an in-range index alone", () => {
    expect(wrapIndex(1, 3)).toBe(1);
  });
});

describe("triggerKeyAction", () => {
  it("ArrowDown opens to the first item", () => {
    expect(triggerKeyAction("ArrowDown", 3)).toEqual({ type: "open", focusIndex: 0 });
  });

  it("ArrowUp opens to the last item", () => {
    expect(triggerKeyAction("ArrowUp", 3)).toEqual({ type: "open", focusIndex: 2 });
  });

  it("Escape closes", () => {
    expect(triggerKeyAction("Escape", 3)).toEqual({ type: "close" });
  });

  it("an unhandled key does nothing", () => {
    expect(triggerKeyAction("a", 3)).toEqual({ type: "none" });
  });

  // Enter/Space are deliberately absent: the button's native click
  // activation handles them (see nav-dropdown.tsx's onClick), so this
  // function must not also claim them.
  it("does not claim Enter or Space", () => {
    expect(triggerKeyAction("Enter", 3)).toEqual({ type: "none" });
    expect(triggerKeyAction(" ", 3)).toEqual({ type: "none" });
  });
});

describe("itemKeyAction", () => {
  it("ArrowDown moves to the next item", () => {
    expect(itemKeyAction("ArrowDown", 0, 3)).toEqual({ type: "focus", index: 1 });
  });

  it("ArrowDown wraps from the last item to the first", () => {
    expect(itemKeyAction("ArrowDown", 2, 3)).toEqual({ type: "focus", index: 0 });
  });

  it("ArrowUp moves to the previous item", () => {
    expect(itemKeyAction("ArrowUp", 2, 3)).toEqual({ type: "focus", index: 1 });
  });

  it("ArrowUp wraps from the first item to the last", () => {
    expect(itemKeyAction("ArrowUp", 0, 3)).toEqual({ type: "focus", index: 2 });
  });

  it("Home jumps to the first item regardless of current index", () => {
    expect(itemKeyAction("Home", 2, 3)).toEqual({ type: "focus", index: 0 });
  });

  it("End jumps to the last item regardless of current index", () => {
    expect(itemKeyAction("End", 0, 3)).toEqual({ type: "focus", index: 2 });
  });

  it("Escape closes and signals refocusing the trigger", () => {
    expect(itemKeyAction("Escape", 1, 3)).toEqual({ type: "close-refocus-trigger" });
  });

  it("Tab closes without refocusing", () => {
    expect(itemKeyAction("Tab", 1, 3)).toEqual({ type: "close" });
  });

  it("an unhandled key does nothing", () => {
    expect(itemKeyAction("a", 1, 3)).toEqual({ type: "none" });
  });
});
