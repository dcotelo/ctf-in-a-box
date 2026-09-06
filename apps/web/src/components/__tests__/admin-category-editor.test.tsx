// The category manager the classic and ai admin panels share — byte-identical
// JSX and identical add/remove/move logic before extraction. The decisions
// (duplicate name, still-in-use refusal, move bounds) are pure and exported
// because this repo's tests render with `renderToStaticMarkup` in vitest's
// node environment and cannot click; the list markup is proven statically.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import CategoryEditor from "@/components/admin/category-editor";
import {
  addCategoryDecision,
  categoriesRequestBody,
  moveInList,
  removeCategoryDecision,
} from "@/components/admin/use-category-editor";

const noop = () => {};

describe("categoriesRequestBody", () => {
  it("carries exactly one key, categories, as a fresh array", () => {
    const input = ["Web", "Crypto"];
    const body = categoriesRequestBody(input);
    expect(Object.keys(body)).toEqual(["categories"]);
    expect(body.categories).toEqual(input);
    expect(body.categories).not.toBe(input);
  });
});

describe("addCategoryDecision", () => {
  it("is a no-op for a blank name", () => {
    expect(addCategoryDecision("   ", ["Web"])).toEqual({ kind: "noop" });
  });

  it("refuses a name already present, case-insensitively, with the exact sentence", () => {
    expect(addCategoryDecision(" web ", ["Web"])).toEqual({ kind: "duplicate", message: '"web" is already a category.' });
  });

  it("appends the trimmed name", () => {
    expect(addCategoryDecision(" Crypto ", ["Web"])).toEqual({ kind: "add", next: ["Web", "Crypto"] });
  });
});

describe("removeCategoryDecision", () => {
  it("refuses while challenges still use it, naming the count with the right grammar", () => {
    expect(removeCategoryDecision("Web", 1)).toEqual({
      kind: "refuse",
      message: 'Can\'t remove "Web" — 1 challenge still uses it. Reassign or delete it first.',
    });
    expect(removeCategoryDecision("Web", 3)).toEqual({
      kind: "refuse",
      message: 'Can\'t remove "Web" — 3 challenges still use it. Reassign or delete them first.',
    });
  });

  it("removes an unused category", () => {
    expect(removeCategoryDecision("Web", 0)).toEqual({ kind: "remove" });
  });
});

describe("moveInList", () => {
  it("moves an entry to the target index", () => {
    expect(moveInList(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveInList(["a", "b", "c"], 2, 1)).toEqual(["a", "c", "b"]);
  });

  it("returns null for an out-of-range target, so nothing is written", () => {
    expect(moveInList(["a", "b"], 0, -1)).toBeNull();
    expect(moveInList(["a", "b"], 1, 2)).toBeNull();
  });
});

describe("CategoryEditor", () => {
  function render(overrides: Partial<Parameters<typeof CategoryEditor>[0]> = {}) {
    return renderToStaticMarkup(
      <CategoryEditor
        categories={["Web", "Crypto"]}
        input=""
        error={null}
        pending={false}
        onInput={noop}
        onAdd={noop}
        onRemove={noop}
        onMove={noop}
        {...overrides}
      />,
    );
  }

  it("renders every category as a chip with keyboard move and remove controls", () => {
    const html = render();
    expect(html).toContain("Categories");
    expect(html).toContain("Web");
    expect(html).toContain("Crypto");
    // Inline chips move left/right, not up/down; every control is named
    // after its chip for assistive tech.
    expect(html).toContain('aria-label="Move &quot;Web&quot; left"');
    expect(html).toContain('aria-label="Move &quot;Crypto&quot; right"');
    expect(html).toContain('aria-label="Remove &quot;Web&quot;"');
    expect(html).toContain("Remove");
    expect(html).toContain("Add category");
    expect(html).not.toContain("<details");
  });

  it("keeps the chip controls in the tree at low opacity, revealed on hover or focus, never hidden", () => {
    const html = render();
    expect(html).toMatch(/opacity-40[^"]*group-focus-within:opacity-100[^"]*group-hover:opacity-100/);
    expect(html).not.toContain("opacity-0");
  });

  it("gives Remove a neutral colour — danger is for the confirmations that destroy something", () => {
    const html = render();
    expect(html).not.toContain("#e53e3e]/40");
  });

  it("disables Move left on the first chip and Move right on the last", () => {
    const html = render();
    expect(html).toMatch(/<button[^>]*aria-label="Move &quot;Web&quot; left"[^>]*disabled=""/);
    expect(html).toMatch(/<button[^>]*aria-label="Move &quot;Crypto&quot; right"[^>]*disabled=""/);
    expect(html).not.toMatch(/<button[^>]*aria-label="Move &quot;Web&quot; right"[^>]*disabled=""/);
  });

  it("shows the empty-list placeholder", () => {
    expect(render({ categories: [] })).toContain("No categories yet — add one before authoring a challenge.");
  });

  it("disables Add category until something is typed", () => {
    expect(render()).toMatch(/<button[^>]*disabled=""[^>]*>Add category</);
    expect(render({ input: "Pwn" })).not.toMatch(/<button[^>]*disabled=""[^>]*>Add category</);
  });

  it("renders the error line when there is one", () => {
    expect(render({ error: '"Web" is already a category.' })).toContain(
      '<p class="text-xs text-[#e53e3e]">&quot;Web&quot; is already a category.</p>',
    );
  });
});
