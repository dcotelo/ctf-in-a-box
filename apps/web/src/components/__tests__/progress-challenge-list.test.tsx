// The grouped list inside an expanded row. The ordering rules are the whole
// point of the component: a contestant opening a 110-row target should land on
// the category with the most points still winnable, with the rows they can
// still act on above the ones they have already done.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ChallengeList, { COLLAPSE_ABOVE, groupItems, type ProgressItem } from "@/components/progress/challenge-list";

function item(over: Partial<ProgressItem> & { key: string }): ProgressItem {
  return { name: over.key, points: 5, done: false, status: "Open", tone: "open", ...over };
}

describe("groupItems", () => {
  const items = [
    item({ key: "a1-done", group: "A01", points: 3, done: true, status: "Patched", tone: "done" }),
    item({ key: "a1-open", group: "A01", points: 4 }),
    item({ key: "a3-open", group: "A03", points: 20 }),
    item({ key: "a5-done", group: "A05", points: 50, done: true, status: "Patched", tone: "done" }),
  ];

  it("orders groups by the points still open, not by size or catalogue order", () => {
    // A05 holds the most points but none of them are still winnable, so it
    // sorts last: the list answers "what is worth doing next".
    expect(groupItems(items).map((g) => g.name)).toEqual(["A03", "A01", "A05"]);
  });

  it("sinks done rows to the bottom of their own group, keeping catalogue order otherwise", () => {
    const a01 = groupItems(items).find((g) => g.name === "A01")!;
    expect(a01.items.map((i) => i.key)).toEqual(["a1-open", "a1-done"]);
  });

  it("counts each group's open, earned and available points", () => {
    const a01 = groupItems(items).find((g) => g.name === "A01")!;
    expect(a01).toMatchObject({ openPoints: 4, earnedPoints: 3, maxPoints: 7, doneCount: 1 });
  });

  it("is one anonymous bucket for a module with no grouping of its own", () => {
    const flat = [item({ key: "q1" }), item({ key: "q2", done: true, status: "Answered", tone: "done" })];
    const groups = groupItems(flat);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBeNull();
    expect(groups[0].items.map((i) => i.key)).toEqual(["q1", "q2"]);
  });

  it("keeps equal groups in the order they arrived rather than shuffling them", () => {
    const tied = [item({ key: "w", group: "Web" }), item({ key: "c", group: "Crypto" })];
    expect(groupItems(tied).map((g) => g.name)).toEqual(["Web", "Crypto"]);
  });
});

describe("ChallengeList", () => {
  it("renders nothing at all for an empty list", () => {
    expect(renderToStaticMarkup(<ChallengeList items={[]} unit="patched" doneWord="patched" />)).toBe("");
  });

  it("names every row's status in words, never colour alone", () => {
    const html = renderToStaticMarkup(
      <ChallengeList
        items={[item({ key: "x", done: true, status: "Patched", tone: "done" }), item({ key: "y" })]}
        unit="patched"
        doneWord="patched"
      />,
    );
    expect(html).toContain("Patched");
    expect(html).toContain("Open");
  });

  it("gives a group a ProgressRow header, and an ungrouped module none", () => {
    const grouped = renderToStaticMarkup(
      <ChallengeList items={[item({ key: "x", group: "A01" })]} unit="patched" doneWord="patched" />,
    );
    expect(grouped).toContain("A01");
    expect(grouped).toContain('role="progressbar"');
    const flat = renderToStaticMarkup(<ChallengeList items={[item({ key: "x" })]} unit="answered" doneWord="answered" />);
    expect(flat).not.toContain('role="progressbar"');
  });

  it("leaves a short group's done rows on screen — the toggle would cost more than it saves", () => {
    const short = [
      ...Array.from({ length: 5 }, (_, i) => item({ key: `open${i}`, group: "A01" })),
      item({ key: "done0", group: "A01", done: true, status: "Patched", tone: "done" }),
    ];
    const html = renderToStaticMarkup(<ChallengeList items={short} unit="patched" doneWord="patched" />);
    expect(html).toContain("done0");
    expect(html).not.toContain("Show patched");
  });

  it("collapses the done rows of a long group behind a toggle naming how many", () => {
    const long = [
      ...Array.from({ length: COLLAPSE_ABOVE }, (_, i) => item({ key: `open${i}`, group: "A01" })),
      ...Array.from({ length: 3 }, (_, i) =>
        item({ key: `done${i}`, group: "A01", done: true, status: "Patched", tone: "done" }),
      ),
    ];
    const html = renderToStaticMarkup(<ChallengeList items={long} unit="patched" doneWord="patched" />);
    expect(html).toContain("Show patched (3)");
    expect(html).toContain("open0");
    expect(html).not.toContain("done0");
    // The group header still counts them, so the rows are hidden, not lost.
    expect(html).toContain("13 patched");
  });

  it("has nothing to collapse in a long group with nothing done", () => {
    const long = Array.from({ length: COLLAPSE_ABOVE + 5 }, (_, i) => item({ key: `open${i}`, group: "A01" }));
    expect(renderToStaticMarkup(<ChallengeList items={long} unit="patched" doneWord="patched" />)).not.toContain(
      "Show patched",
    );
  });

  it("uses the module's own word for the rows it hides", () => {
    const long = [
      ...Array.from({ length: COLLAPSE_ABOVE }, (_, i) => item({ key: `open${i}`, group: "Web" })),
      item({ key: "done0", group: "Web", done: true, status: "Solved", tone: "done" }),
    ];
    expect(renderToStaticMarkup(<ChallengeList items={long} unit="solved" doneWord="solved" />)).toContain(
      "Show solved (1)",
    );
  });
});
