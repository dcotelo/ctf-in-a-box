// @testing-library/react is not a dependency of this repo and must not be
// added just for this test. AdminClassicControls has one effect (the
// mount-time GET /api/admin/classic fetch), which never runs under
// `renderToStaticMarkup` — same pattern as admin-quiz-controls.test.tsx.
//
// The add/edit form and the delete ConfirmModal are gated behind `useState`
// in `AdminClassicControls` itself (`editing`, `deleteTarget`), so neither
// ever appears in a plain static render of that component — clicking "Edit"
// is a browser interaction this repo's test setup cannot simulate. The form
// (`ChallengeForm`) is exported specifically so its masking/preview/no-id
// properties can be proven by rendering it DIRECTLY — the same component
// `AdminClassicControls` mounts once an organizer clicks Edit, not a copy —
// rather than by driving the parent's state. Everything else (list rendering,
// keyboard move buttons, delete-confirmation gating) is proven either through
// the list markup (never gated) or through the exported pure helpers
// (`challengeDeleteConfirm`, `confirmPhraseFromTitle`, `isDraftValid`,
// `draftFromChallenge`, `payloadFromEditor`, `categoryUsageCount`, ...).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CLASSIC_ID_RE } from "@/lib/classic-keys";
import { CLASSIC_BUNDLE_VERSION, parseBundle, serializeBundle } from "@/lib/classic-io";
import type { AdminChallenge, Challenge } from "@/lib/classic-store";
import AdminClassicControls, {
  CLASSIC_POINTS_MAX,
  ChallengeForm,
  categoriesRequestBody,
  categoryUsageCount,
  changedOrderRows,
  challengeDeleteConfirm,
  confirmPhraseFromTitle,
  describeClassicError,
  draftFromChallenge,
  editorFromChallenge,
  emptyDraft,
  exportBundleFrom,
  formatImportSummary,
  isDraftValid,
  newChallengeEditor,
  payloadFromEditor,
  payloadFromRow,
  reorderChallenges,
  type ChallengeDraft,
} from "@/components/admin-classic-controls";

const noop = () => {};

const c1: Challenge = {
  id: "sql-injection-101-ab12cd",
  title: "SQL Injection 101",
  category: "Web",
  description: "Find the flag in the login form.",
  points: 50,
  order: 1,
};

const c2: Challenge = {
  id: "xss-basics-zz9kq2",
  title: "XSS Basics",
  category: "Web",
  description: "",
  points: 25,
  order: 2,
};

const row1: AdminChallenge = { challenge: c1, flag: "CTF{real}", hint: null };
const row2: AdminChallenge = { challenge: c2, flag: "CTF{other}", hint: null };

function renderControls(initialChallenges: AdminChallenge[] = [], initialCategories: string[] = ["Web"]) {
  return renderToStaticMarkup(
    <AdminClassicControls
      pending={false}
      classicCooldownSecInput="5"
      setClassicCooldownSecInput={noop}
      commitNumber={noop}
      initialChallenges={initialChallenges}
      initialCategories={initialCategories}
    />,
  );
}

describe("AdminClassicControls", () => {
  it("renders the cooldown setting input with its current value", () => {
    const html = renderControls();
    expect(html).toContain("Submission cooldown (sec)");
    expect(html).toMatch(/value="5"/);
  });

  it("renders an Add challenge control and a placeholder when there are none", () => {
    const html = renderControls();
    expect(html).toContain("Add challenge");
    expect(html).toContain("No challenges yet.");
  });

  it("renders each challenge with edit and delete controls, never the placeholder", () => {
    const html = renderControls([row1]);
    expect(html).toContain(c1.title);
    expect(html).toContain("Edit");
    expect(html).toContain("Delete");
    expect(html).not.toContain("No challenges yet.");
  });

  // Dragging is a mouse gesture. The reorder controls must also exist as real
  // buttons, or an organizer who navigates by keyboard cannot order their own
  // challenge set at all. (Drag itself is not simulable — no testing-library
  // in this repo — the logic both paths call, `reorderChallenges`, is tested
  // directly below.)
  it("renders a keyboard-operable move control on every challenge", () => {
    const html = renderControls([row1, row2]);
    expect(html).toContain(`Move &quot;${c1.title}&quot; up`);
    expect(html).toContain(`Move &quot;${c2.title}&quot; down`);
    expect(html).toMatch(/Move up/);
    expect(html).toMatch(/Move down/);
  });

  // The component HOLDS the flag (that's the point — the edit form prefills
  // from it), but the collapsed list must not paint it: an organizer browsing
  // their challenges may well be doing it on a projector.
  it("keeps flags out of the collapsed list markup", () => {
    const html = renderControls([row1]);
    expect(html).toContain(c1.title);
    expect(html).not.toContain(row1.flag);
  });

  it("offers no id field in the collapsed view — ids are generated, never typed", () => {
    const html = renderControls([]);
    expect(html).not.toMatch(/name="id"/);
  });

  describe("category editor", () => {
    it("renders the category list with move and remove controls", () => {
      const html = renderControls([], ["Web", "Crypto"]);
      expect(html).toContain("Web");
      expect(html).toContain("Crypto");
      expect(html).toContain("Add category");
      expect(html).toMatch(/Move up/);
      expect(html).toMatch(/Move down/);
      expect(html).toContain("Remove");
    });

    it("shows a placeholder and disables Add challenge when there are no categories", () => {
      const html = renderControls([], []);
      expect(html).toContain("No categories yet");
      // disabled="" is how renderToStaticMarkup serializes a disabled
      // attribute; matched against the specific <button>...Add challenge
      // element rather than anywhere in the document.
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Add challenge</);
    });
  });

  // The bulk panel is a <details>/<summary> pair, not a `useState` toggle —
  // its content appears in a static render regardless of open/closed, which
  // is what lets these controls be proven here at all (see this file's own
  // header comment on why a `useState`-gated section cannot be).
  describe("bulk import / export panel", () => {
    it("renders the bulk panel with import and export controls", () => {
      const html = renderControls([row1]);
      expect(html).toMatch(/bulk import/i);
      expect(html).toContain('type="file"');
      expect(html).toMatch(/export/i);
    });

    it("states that import never deletes", () => {
      const html = renderControls([row1]);
      expect(html).toMatch(/never deletes|not delete|leaves .* untouched/i);
    });

    it("builds an export bundle from the loaded board, flags included", () => {
      const bundle = exportBundleFrom([row1], ["Web"]);
      expect(bundle.version).toBe(CLASSIC_BUNDLE_VERSION);
      expect(bundle.categories).toEqual(["Web"]);
      expect(bundle.challenges[0].flag).toBe(row1.flag);
      expect(bundle.challenges[0].id).toBe(row1.challenge.id);
    });

    it("produces an export that its own parser accepts", () => {
      const text = serializeBundle(exportBundleFrom([row1], ["Web"]));
      expect(parseBundle(text).ok).toBe(true);
    });
  });

  // `formatImportSummary` is the pure function behind the after-import
  // message — pulled out specifically because `importResult` is `useState`
  // and this file's `renderControls` uses `renderToStaticMarkup`, which never
  // runs a click handler or touches post-mount state. Without this extracted,
  // the pluralization ternary (and the created/updated interpolation next to
  // it) would ship untested.
  describe("formatImportSummary", () => {
    it("pluralizes categories for anything other than exactly one", () => {
      expect(formatImportSummary({ created: 1, updated: 0, categories: 0 })).toBe(
        "Imported: 1 created, 0 updated. (0 categories listed in the file.)",
      );
      expect(formatImportSummary({ created: 3, updated: 2, categories: 2 })).toBe(
        "Imported: 3 created, 2 updated. (2 categories listed in the file.)",
      );
    });

    it("uses the singular for exactly one category", () => {
      expect(formatImportSummary({ created: 0, updated: 5, categories: 1 })).toBe(
        "Imported: 0 created, 5 updated. (1 category listed in the file.)",
      );
    });
  });
});

describe("ChallengeForm — the masking/preview/no-id properties an organizer actually sees", () => {
  function renderForm(overrides: Partial<Parameters<typeof ChallengeForm>[0]> = {}) {
    const editor = editorFromChallenge(row1);
    return renderToStaticMarkup(
      <ChallengeForm
        editor={editor}
        categories={["Web"]}
        pending={false}
        error={null}
        flagRevealed={false}
        setFlagRevealed={noop}
        onChange={noop}
        onCancel={noop}
        onSubmit={noop}
        {...overrides}
      />,
    );
  }

  // Present the stored flag as a value the organizer can edit — the whole
  // argument for storing it in plaintext — but never rendered in the clear.
  it("prefills the existing flag when editing, masked until revealed", () => {
    const html = renderForm();
    expect(html).toContain('type="password"');
    expect(html).toMatch(/value="CTF{real}"/);
    expect(html).toMatch(/reveal/i);
  });

  it("switches to a plain text input once revealed", () => {
    const html = renderForm({ flagRevealed: true });
    expect(html).toContain('type="text"');
    expect(html).not.toContain('type="password"');
    expect(html).toMatch(/hide/i);
  });

  // No input the organizer can type an id into, on a NEW challenge either.
  it("offers no id input on a new challenge — the id is generated at save", () => {
    const html = renderToStaticMarkup(
      <ChallengeForm
        editor={newChallengeEditor(1, "Web")}
        categories={["Web"]}
        pending={false}
        error={null}
        flagRevealed={false}
        setFlagRevealed={noop}
        onChange={noop}
        onCancel={noop}
        onSubmit={noop}
      />,
    );
    expect(html).not.toMatch(/<input[^>]*name="id"/);
    // id shows nowhere as an editable value; it's stated as generated.
    expect(html).toMatch(/generated from the title/i);
  });

  it("shows the fixed, non-editable id on an existing challenge", () => {
    const html = renderForm();
    expect(html).toContain(c1.id);
    expect(html).toMatch(/fixed for the life of the challenge/i);
  });

  // The preview renders through the SAME <Markdown> component the contestant
  // board uses. A second renderer here would drift and stop being a preview
  // of anything real.
  it("previews the description through the same renderer the board uses", () => {
    const editor = editorFromChallenge({ challenge: { ...c1, description: "**b**" }, flag: "f", hint: null });
    const html = renderToStaticMarkup(
      <ChallengeForm
        editor={editor}
        categories={["Web"]}
        pending={false}
        error={null}
        flagRevealed={false}
        setFlagRevealed={noop}
        onChange={noop}
        onCancel={noop}
        onSubmit={noop}
      />,
    );
    expect(html).toMatch(/<strong[^>]*>b<\/strong>/);
  });
});

describe("draftFromChallenge", () => {
  it("prefills the flag, title, category and description when editing an existing challenge", () => {
    const draft = draftFromChallenge(row1);
    expect(draft.flag).toBe(row1.flag);
    expect(draft.title).toBe(c1.title);
    expect(draft.category).toBe(c1.category);
    expect(draft.description).toBe(c1.description);
    expect(draft.points).toBe(String(c1.points));
  });

  it("carries no id or order field for the form to change", () => {
    expect(Object.keys(draftFromChallenge(row1))).not.toContain("id");
    expect(Object.keys(draftFromChallenge(row1))).not.toContain("order");
    expect(Object.keys(emptyDraft())).not.toContain("id");
    expect(Object.keys(emptyDraft())).not.toContain("order");
  });
});

// A challenge's id is the field name in `ctf:classic:challenges`,
// `ctf:classic:flag` and `ctf:classic:flagnorm` AND the reference every
// contestant's `ctf:classic:solves:<login>` row is recorded against. Change
// it on an existing challenge and every banked solve is orphaned.
describe("payloadFromEditor — an edit can never change a challenge's id", () => {
  it("submits the stored id even when every other field has been rewritten", () => {
    const editor = editorFromChallenge(row1);
    const draft: ChallengeDraft = {
      title: "A completely different title",
      category: "Web",
      description: "New description",
      points: "999",
      flag: "CTF{changed}",
      caseSensitive: false,
      hint: "",
    };
    const payload = payloadFromEditor({ ...editor, draft }, () => "generated-from-the-new-title");
    expect(payload.id).toBe(c1.id);
    // Non-vacuity: the rewrite really did land.
    expect(payload.title).toBe("A completely different title");
    expect(payload.points).toBe(999);
    expect(payload.flag).toBe("CTF{changed}");
  });

  it("keeps the id across a title that would generate a different one", () => {
    const editor = editorFromChallenge({ challenge: { ...c1, id: "legacy-hand-typed-id" }, flag: "f", hint: null });
    const payload = payloadFromEditor({ ...editor, draft: { ...editor.draft, title: "New title entirely" } });
    expect(payload.id).toBe("legacy-hand-typed-id");
  });

  it("keeps the challenge's existing position rather than re-deriving one", () => {
    const editor = editorFromChallenge({ challenge: { ...c1, order: 7 }, flag: "f", hint: null });
    expect(payloadFromEditor(editor).order).toBe(7);
  });

  it("generates an id from the title for a NEW challenge", () => {
    const editor = newChallengeEditor(4, "Web");
    const draft: ChallengeDraft = { ...editor.draft, title: "SQL Injection 101", flag: "CTF{x}" };
    const payload = payloadFromEditor({ ...editor, draft });
    expect(payload.id).toMatch(CLASSIC_ID_RE);
    expect(payload.id).toContain("sql-injection-101");
    expect(payload.order).toBe(4);
  });

  it("mints a DIFFERENT id for each new challenge with the same title", () => {
    const editor = newChallengeEditor(1, "Web");
    const draft: ChallengeDraft = { ...editor.draft, title: "Same title twice", flag: "f" };
    const first = payloadFromEditor({ ...editor, draft }).id;
    const second = payloadFromEditor({ ...editor, draft }).id;
    expect(first).not.toBe(second);
  });

  it("carries exactly the wire contract's challenge keys, nothing more", () => {
    const payload = payloadFromEditor(editorFromChallenge(row1));
    expect(Object.keys(payload).sort()).toEqual(
      ["category", "description", "flag", "hint", "id", "order", "points", "title"].sort(),
    );
  });
});

describe("payloadFromRow", () => {
  it("round-trips a stored row unchanged, so a reorder re-saves only the order", () => {
    const payload = payloadFromRow({ challenge: { ...c1, order: 3 }, flag: "CTF{real}", hint: null });
    expect(payload).toEqual({
      id: c1.id,
      title: c1.title,
      category: c1.category,
      description: c1.description,
      points: c1.points,
      order: 3,
      flag: "CTF{real}",
      hint: "",
    });
  });
});

describe("reorderChallenges", () => {
  const rows = (...ids: string[]): AdminChallenge[] =>
    ids.map((id, i) => ({ challenge: { ...c1, id, title: `Title ${id}`, order: i + 1 }, flag: "f", hint: null }));

  const shape = (list: AdminChallenge[]) => list.map((r) => [r.challenge.id, r.challenge.order] as const);

  it("moves a row down and renumbers every position from 1", () => {
    expect(shape(reorderChallenges(rows("a", "b", "c", "d"), 0, 2))).toEqual([
      ["b", 1],
      ["c", 2],
      ["a", 3],
      ["d", 4],
    ]);
  });

  it("moves a row up and renumbers every position from 1", () => {
    expect(shape(reorderChallenges(rows("a", "b", "c", "d"), 3, 0))).toEqual([
      ["d", 1],
      ["a", 2],
      ["b", 3],
      ["c", 4],
    ]);
  });

  it("never mutates the list it was given", () => {
    const before = rows("a", "b", "c");
    reorderChallenges(before, 0, 2);
    expect(shape(before)).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
  });

  it("treats an out-of-range index as a no-op rather than a silent renumbering", () => {
    const sparse: AdminChallenge[] = [
      { challenge: { ...c1, id: "a", order: 0 }, flag: "f", hint: null },
      { challenge: { ...c1, id: "b", order: 40 }, flag: "f", hint: null },
    ];
    expect(shape(reorderChallenges(sparse, 0, 5))).toEqual([
      ["a", 0],
      ["b", 40],
    ]);
  });
});

describe("changedOrderRows", () => {
  const rows = (...ids: string[]): AdminChallenge[] =>
    ids.map((id, i) => ({ challenge: { ...c1, id, order: i + 1 }, flag: "f", hint: null }));

  it("names exactly the challenges a move has to write back", () => {
    const before = rows("a", "b", "c", "d");
    const after = reorderChallenges(before, 0, 1);
    expect(changedOrderRows(before, after).map((r) => r.challenge.id).sort()).toEqual(["a", "b"]);
  });

  it("is empty when nothing moved, so a no-op drag writes nothing", () => {
    const before = rows("a", "b", "c");
    expect(changedOrderRows(before, reorderChallenges(before, 1, 1))).toEqual([]);
  });
});

describe("isDraftValid", () => {
  const base: ChallengeDraft = { ...emptyDraft("Web"), title: "t", flag: "f" };
  const categories = ["Web"];

  it("accepts a fully-filled draft", () => {
    expect(isDraftValid(base, categories)).toBe(true);
  });

  it("rejects a missing title", () => {
    expect(isDraftValid({ ...base, title: "" }, categories)).toBe(false);
    expect(isDraftValid({ ...base, title: "   " }, categories)).toBe(false);
  });

  it("rejects a category not in the current category list", () => {
    expect(isDraftValid({ ...base, category: "Crypto" }, categories)).toBe(false);
  });

  it("rejects a missing flag", () => {
    expect(isDraftValid({ ...base, flag: "" }, categories)).toBe(false);
    expect(isDraftValid({ ...base, flag: "   " }, categories)).toBe(false);
  });

  it("rejects a non-integer or out-of-range points value", () => {
    expect(isDraftValid({ ...base, points: "1.5" }, categories)).toBe(false);
    expect(isDraftValid({ ...base, points: "" }, categories)).toBe(false);
    expect(isDraftValid({ ...base, points: "-1" }, categories)).toBe(false);
    expect(isDraftValid({ ...base, points: String(CLASSIC_POINTS_MAX + 1) }, categories)).toBe(false);
  });

  it("accepts points at the maximum", () => {
    expect(isDraftValid({ ...base, points: String(CLASSIC_POINTS_MAX) }, categories)).toBe(true);
  });

  it("rejects a description longer than MARKDOWN_MAX", () => {
    expect(isDraftValid({ ...base, description: "x".repeat(4001) }, categories)).toBe(false);
  });
});

describe("confirmPhraseFromTitle", () => {
  it("uses a short title verbatim", () => {
    expect(confirmPhraseFromTitle("SQL Injection 101", "fallback-id")).toBe("SQL Injection 101");
  });

  it("collapses whitespace", () => {
    expect(confirmPhraseFromTitle("  SQL   Injection\n101 ", "fallback-id")).toBe("SQL Injection 101");
  });

  it("truncates a long title at a word boundary rather than mid-word", () => {
    const long = "A Very Long Challenge Title That Goes On For Quite A While Indeed Truly";
    const phrase = confirmPhraseFromTitle(long, "fallback-id");
    expect(phrase.length).toBeLessThanOrEqual(48);
    expect(long.startsWith(phrase)).toBe(true);
    expect(phrase.endsWith(" ")).toBe(false);
  });

  // THE guard: `ConfirmModal` treats an empty `requireType` as "no
  // confirmation required" (see its own comment), so a blank/whitespace-only
  // title must never produce an empty phrase — it must fall back to
  // something that is always non-empty.
  it("falls back to the id for a blank title, never returning an empty string", () => {
    expect(confirmPhraseFromTitle("", "sql-injection-101-ab12cd")).toBe("sql-injection-101-ab12cd");
    expect(confirmPhraseFromTitle("   ", "sql-injection-101-ab12cd")).toBe("sql-injection-101-ab12cd");
  });
});

describe("challengeDeleteConfirm", () => {
  it("requires typing the challenge's own title to confirm — not a generic phrase", () => {
    const copy = challengeDeleteConfirm(c1);
    expect(copy.requireType).toBe(c1.title);
    expect(copy.title).toContain(c1.title);
  });

  it("still shows the id, so a shared title prefix is never ambiguous", () => {
    expect(challengeDeleteConfirm(c1).body).toContain(c1.id);
  });

  it("promises only what deletion actually does — the challenge goes, banked points stay", () => {
    const { body } = challengeDeleteConfirm(c1);
    expect(body).toMatch(/removes the challenge/i);
    expect(body).toMatch(/points already banked.*(stay|remain)/i);
    expect(body).toMatch(/master reset/i);
  });

  // The non-negotiable guard, exercised end to end through the real function
  // a click handler calls: a whitespace-only title must never leave
  // `requireType` empty, or `ConfirmModal` treats the confirmation as not
  // required at all and the challenge deletes on a single click.
  it("never produces an empty requireType, even for a whitespace-only title", () => {
    const blank: Challenge = { ...c1, title: "   " };
    const copy = challengeDeleteConfirm(blank);
    expect(copy.requireType.length).toBeGreaterThan(0);
    expect(copy.requireType).toBe(c1.id);
  });
});

describe("describeClassicError", () => {
  it("surfaces a 400 validation error as the store's own message", () => {
    expect(describeClassicError(400, "Invalid challenge id: !!")).toBe("Invalid challenge id: !!");
  });

  it("surfaces a 503 infrastructure failure distinctly from a validation error", () => {
    const msg = describeClassicError(503, "classic store write failed");
    expect(msg).not.toBe("classic store write failed");
    expect(msg).toMatch(/unavailable/i);
  });

  it("never claims the payload was bad when the store itself failed", () => {
    const msg = describeClassicError(503, "classic store write failed");
    expect(msg.toLowerCase()).not.toContain("invalid");
  });
});

describe("categoryUsageCount", () => {
  it("counts exactly the challenges filed under a category", () => {
    expect(categoryUsageCount([row1, row2], "Web")).toBe(2);
    expect(categoryUsageCount([row1, row2], "Crypto")).toBe(0);
  });

  it("is case-sensitive against the exact stored category string", () => {
    expect(categoryUsageCount([row1], "web")).toBe(0);
  });
});

// Wire-contract test: drives `categoriesRequestBody` — the EXACT function
// `postCategories` builds every categories POST body from — straight into
// the REAL `/api/admin/classic` route handler, with only the route's own
// dependencies (auth, the store, the audit pipeline) faked out. This is
// deliberately NOT a reimplementation of the route's dispatch rule as a local
// assertion: it proves the actual server-side parser (Task 7's
// `Object.keys(body).length === 1 && keys[0] === "categories"` check, see
// route.ts) accepts what this client sends. Mirrors
// api/admin/classic/__tests__/route.test.ts's own mocking setup.
const {
  requireAdmin: wireRequireAdmin,
  setCategories: wireSetCategories,
  upsertChallenge: wireUpsertChallenge,
  listChallengesForAdmin: wireListChallengesForAdmin,
  listCategories: wireListCategories,
  deleteChallenge: wireDeleteChallenge,
  upstashPipeline: wireUpstashPipeline,
} = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  setCategories: vi.fn(),
  upsertChallenge: vi.fn(),
  listChallengesForAdmin: vi.fn(),
  listCategories: vi.fn(),
  deleteChallenge: vi.fn(),
  upstashPipeline: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin: wireRequireAdmin }));
vi.mock("@/lib/classic-store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/classic-store")>("@/lib/classic-store");
  return {
    ...actual,
    setCategories: wireSetCategories,
    upsertChallenge: wireUpsertChallenge,
    listChallengesForAdmin: wireListChallengesForAdmin,
    listCategories: wireListCategories,
    deleteChallenge: wireDeleteChallenge,
  };
});
vi.mock("@/lib/admin-store", () => ({ ADMIN_AUDIT_KEY: "ctf:admin:audit", AUDIT_CAP: 500 }));
vi.mock("@/lib/upstash", () => ({ upstashPipeline: wireUpstashPipeline }));

const { POST: wirePOST } = await import("@/app/api/admin/classic/route");

describe("categories POST wire contract, proven against the real route", () => {
  beforeEach(() => {
    wireRequireAdmin.mockReset().mockResolvedValue({ ok: true, login: "alice" });
    wireSetCategories.mockReset().mockImplementation(async (names: string[]) => names);
    wireUpstashPipeline.mockReset().mockResolvedValue([{ result: "OK" }, { result: "OK" }]);
  });

  const post = (body: unknown) =>
    wirePOST(new Request("http://x/api/admin/classic", { method: "POST", body: JSON.stringify(body) }));

  it("the exact body this component sends is accepted by the real route", async () => {
    const res = await post(categoriesRequestBody(["Web", "Crypto"]));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ categories: ["Web", "Crypto"] });
  });

  // THE required mutation check: if `categoriesRequestBody` ever grows a
  // second key, this same call — through the SAME real route, not a
  // reimplementation of its rule — must start failing. Proven here directly
  // rather than only asserted about, so a future change to
  // `categoriesRequestBody` is caught by an actual protocol rejection.
  it("a body carrying one extra key alongside categories is rejected by the real route", async () => {
    const withExtraKey = { ...categoriesRequestBody(["Web"]), extra: true };
    const res = await post(withExtraKey);
    expect(res.status).toBe(400);
    expect(wireSetCategories).not.toHaveBeenCalled();
  });
});

// Case-sensitive flags (issue #193). The field passes through four hands —
// form draft, payload, route parser, store — and the failure mode of dropping
// it anywhere is silent: the challenge simply grades the forgiving way and
// nobody finds out until a contestant submits the right characters in the
// wrong case and is told they are wrong.
describe("caseSensitive survives the form round trip", () => {
  it("is omitted from the payload when off, so an unchanged challenge re-saves identically", () => {
    const editor = editorFromChallenge(row1);
    const payload = payloadFromEditor({ ...editor, draft: { ...editor.draft, caseSensitive: false } });
    expect("caseSensitive" in payload).toBe(false);
  });

  it("is sent as true when on", () => {
    const editor = editorFromChallenge(row1);
    const payload = payloadFromEditor({ ...editor, draft: { ...editor.draft, caseSensitive: true } });
    expect(payload.caseSensitive).toBe(true);
  });

  it("seeds the edit form as a real boolean, never undefined", () => {
    // The stored field is absent-when-false. Handing `undefined` to a checkbox
    // makes React flip the input from controlled to uncontrolled the first
    // time it is ticked, which is a console warning and a form that stops
    // tracking its own state.
    const draft = draftFromChallenge(row1);
    expect(typeof draft.caseSensitive).toBe("boolean");
  });

  it("seeds true from a stored case-sensitive challenge", () => {
    const draft = draftFromChallenge({
      ...row1,
      challenge: { ...row1.challenge, caseSensitive: true },
    });
    expect(draft.caseSensitive).toBe(true);
  });
});
