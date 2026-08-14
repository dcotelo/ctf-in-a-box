// The FAQ accordion opens a panel from the URL hash so /faq#allied-ops can deep
// link straight to one answer. The matching itself is pure and lives outside the
// component because vitest runs `environment: "node"` here — there is no DOM to
// render the accordion into.

import { describe, expect, it } from "vitest";
import { indexForHash } from "@/lib/faq-anchor";

const items = [
  { id: "first-question" },
  { id: "allied-ops" },
  {},
];

describe("indexForHash", () => {
  it("finds the item whose id matches the hash", () => {
    expect(indexForHash(items, "#allied-ops")).toBe(1);
    expect(indexForHash(items, "#first-question")).toBe(0);
  });

  it("accepts a hash with or without the leading #", () => {
    expect(indexForHash(items, "allied-ops")).toBe(1);
  });

  it("returns null when nothing matches", () => {
    expect(indexForHash(items, "#no-such-question")).toBe(null);
  });

  it("returns null for an absent or empty hash", () => {
    expect(indexForHash(items, undefined)).toBe(null);
    expect(indexForHash(items, "")).toBe(null);
    expect(indexForHash(items, "#")).toBe(null);
  });

  it("never matches an item that has no id", () => {
    expect(indexForHash([{}, {}], "#allied-ops")).toBe(null);
    // An empty hash must not fall through to the first id-less item.
    expect(indexForHash([{}], "")).toBe(null);
  });
});
