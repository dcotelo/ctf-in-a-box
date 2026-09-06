// The unsaved-draft guard (audit F17).
//
// The module forms render below the list and every list control stays live
// while one is open, so Edit on another row — or Add — replaced a half-written
// draft in silence. Verified in the audit: text typed into one question's
// prompt vanished the moment Edit was clicked on the next row.
//
// This repo's tests run in vitest's `node` environment and render with
// `renderToStaticMarkup`, so no click and no keystroke can be simulated. The
// decision is therefore a pure exported function (`editorIsDirty`) tested by
// calling it, and the dialog is tested by rendering it directly.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { editorIsDirty } from "@/components/admin/use-admin-resource";
import DiscardDraftConfirm from "@/components/admin/discard-draft-confirm";

const noop = () => {};

/** An editor shaped like the real ones: identity plus a nested draft. */
const editor = { mode: "edit", id: "q1", order: 1, draft: { prompt: "Which header?", choices: [{ id: "a", label: "X" }] } };
const snapshot = JSON.stringify(editor);

describe("editorIsDirty", () => {
  it("is false for an untouched editor, however often it re-rendered", () => {
    // The panels replace the whole editor object on every keystroke, so
    // identity always differs. Only the content can answer this.
    expect(editorIsDirty({ ...editor, draft: { ...editor.draft } }, snapshot)).toBe(false);
  });

  it("is true once a single character changed", () => {
    const typed = { ...editor, draft: { ...editor.draft, prompt: "Which header " } };
    expect(editorIsDirty(typed, snapshot)).toBe(true);
  });

  it("sees a change nested inside the draft, not only at the top level", () => {
    const typed = { ...editor, draft: { ...editor.draft, choices: [{ id: "a", label: "X-Frame-Options" }] } };
    expect(editorIsDirty(typed, snapshot)).toBe(true);
  });

  it("is false when no editor is open — Add on an empty panel asks nothing", () => {
    expect(editorIsDirty(null, null)).toBe(false);
    expect(editorIsDirty(null, snapshot)).toBe(false);
  });

  it("is false when there is no baseline to compare against", () => {
    // An editor set outside `openEditor` has no snapshot. Treating that as
    // dirty would put a dialog in front of a draft nobody typed into.
    expect(editorIsDirty(editor, null)).toBe(false);
  });

  it("calls an unserializable editor dirty — the safe direction", () => {
    // No draft type has a cycle. If one ever does, the cost of being wrong
    // here is a confirmation nobody needed, not work thrown away.
    const cyclic: Record<string, unknown> = { mode: "new" };
    cyclic.self = cyclic;
    expect(editorIsDirty(cyclic, snapshot)).toBe(true);
  });
});

describe("DiscardDraftConfirm", () => {
  const html = renderToStaticMarkup(<DiscardDraftConfirm noun="question" onConfirm={noop} onCancel={noop} />);

  it("names what is about to be lost, in the panel's own noun", () => {
    expect(html).toContain("Discard this question?");
    expect(html).toContain("unsaved changes");
    expect(html).toMatch(/Discard changes/);
  });

  it("does not make the organizer type a phrase", () => {
    // The type-to-confirm gate is for what cannot be undone. Using it here too
    // would teach organizers to type through both.
    expect(html).not.toMatch(/<input/);
  });

  it("is the panel's own dialog, not a native one", () => {
    expect(html).toMatch(/role="dialog"/);
  });
});
