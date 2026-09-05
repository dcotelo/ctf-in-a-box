// The drag-and-keyboard sortable row list the quiz and classic admin panels
// share. Drag events cannot be simulated in this repo's tests (no
// testing-library, vitest's node environment), and by design the list only
// works out a pair of indices for the panel's `onMove` — so what is proven
// here is the markup an organizer and their screen reader get: the intro
// sentence, one row per item with its title and meta line, keyboard move
// buttons with per-row aria-labels and the right disabled states, Edit and
// Delete, and the empty placeholder.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import SortableList from "@/components/admin/sortable-list";

type Row = { item: { id: string; title: string; order: number } };
const rows: Row[] = [
  { item: { id: "a", title: "First thing", order: 1 } },
  { item: { id: "b", title: "Second thing", order: 2 } },
];
const noop = () => {};

function render(overrides: Partial<Parameters<typeof SortableList<Row>>[0]> = {}) {
  return renderToStaticMarkup(
    <SortableList<Row>
      rows={rows}
      keyOf={(r) => r.item.id}
      titleOf={(r) => r.item.title}
      meta={(r) => <>#{r.item.order} · meta</>}
      intro="Drag a thing to reorder it, or use Move up / Move down."
      emptyText="No things yet."
      reorderPending={false}
      onMove={noop}
      onEdit={noop}
      onDelete={noop}
      {...overrides}
    />,
  );
}

describe("SortableList", () => {
  it("renders the empty placeholder and nothing else when there are no rows", () => {
    const html = render({ rows: [] });
    expect(html).toContain("No things yet.");
    expect(html).not.toContain("<ul");
    expect(html).not.toContain("Drag a thing");
  });

  it("renders the intro and one row per item with its title and meta line", () => {
    const html = render();
    expect(html).toContain("Drag a thing to reorder it, or use Move up / Move down.");
    expect(html).toContain("First thing");
    expect(html).toContain("Second thing");
    expect(html).toContain("#2 · meta");
    expect(html.match(/<li /g)?.length).toBe(2);
  });

  it("gives every row keyboard move buttons named after it, plus Edit and Delete", () => {
    const html = render();
    expect(html).toContain('aria-label="Move &quot;First thing&quot; up"');
    expect(html).toContain('aria-label="Move &quot;Second thing&quot; down"');
    expect(html.match(/>Edit</g)?.length).toBe(2);
    expect(html.match(/>Delete</g)?.length).toBe(2);
  });

  it("disables Move up on the first row and Move down on the last, only", () => {
    const html = render();
    expect(html).toMatch(/<button[^>]*aria-label="Move &quot;First thing&quot; up"[^>]*disabled=""/);
    expect(html).toMatch(/<button[^>]*aria-label="Move &quot;Second thing&quot; down"[^>]*disabled=""/);
    expect(html).not.toMatch(/<button[^>]*aria-label="Move &quot;First thing&quot; down"[^>]*disabled=""/);
    expect(html).not.toMatch(/<button[^>]*aria-label="Move &quot;Second thing&quot; up"[^>]*disabled=""/);
  });

  it("marks rows draggable, and stops both drag and the move buttons while a reorder is in flight", () => {
    expect(render()).toContain('draggable="true"');
    const busy = render({ reorderPending: true });
    expect(busy).toContain('draggable="false"');
    expect(busy).toMatch(/<button[^>]*aria-label="Move &quot;First thing&quot; down"[^>]*disabled=""/);
  });

  it("hides the grip glyph from assistive tech", () => {
    expect(render()).toMatch(/<span aria-hidden="true"[^>]*>⠿<\/span>/);
  });
});
