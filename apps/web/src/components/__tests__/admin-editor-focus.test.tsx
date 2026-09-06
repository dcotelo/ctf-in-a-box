// Which control an add/edit form puts the cursor in on open (#282).
//
// `EditorFrame` scrolls itself into view and focuses on every open, because
// the form renders BELOW the list while the button that opens it sits above
// (issue #200, 3.4). Two things broke that: the shared `TextField` rendered an
// input with no `type`, which an `input[type='text']` selector cannot match,
// and the quiz's first field is a textarea the selector would skip past to
// land on a choice-id input instead.
//
// These tests render to static markup and never mount, so they cannot observe
// focus itself. What they pin is what focus depends on: that the form emits a
// node the frame's selectors can find, and that it is the right one.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EDITOR_FOCUS_ATTR } from "@/components/admin/editor-frame";
import QuestionForm from "@/components/admin-quiz-form";
import { newQuestionEditor } from "@/components/admin-quiz-model";

const noop = () => {};

describe("the quiz form's open-focus target", () => {
  const html = renderToStaticMarkup(
    <QuestionForm
      editor={newQuestionEditor(1)}
      pending={false}
      error={null}
      onChange={noop}
      onCancel={noop}
      onSubmit={noop}
    />,
  );

  it("marks exactly one control, so there is no ambiguity about the cursor", () => {
    expect(html.match(new RegExp(EDITOR_FOCUS_ATTR, "g"))).toHaveLength(1);
  });

  it("marks the prompt, not the first choice id", () => {
    // Anchoring on the tag is the point: the frame's fallback selector sees
    // text inputs only, and the first of those in this form is a choice id —
    // storage plumbing, not the sentence the organizer opened the form to
    // write.
    expect(html).toMatch(new RegExp(`<textarea[^>]*${EDITOR_FOCUS_ATTR}`));
    expect(html).not.toMatch(new RegExp(`<input[^>]*${EDITOR_FOCUS_ATTR}`));
  });

  it("still renders the choice-id inputs the fallback would have caught", () => {
    // Non-vacuity: the marker matters precisely because those inputs exist and
    // come first in the markup.
    expect(html).toContain('placeholder="choice id"');
  });
});
