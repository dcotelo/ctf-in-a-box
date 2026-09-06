// @testing-library/react is not a dependency of this repo and must not be
// added just for this test. AdminModuleSetup is purely presentational — every
// bit of state it shows (the module's setup content, the live counts) arrives
// as props — so `renderToStaticMarkup` sees exactly what an organizer sees,
// in whichever state the test hands it. Same pattern as
// admin-ai-integration.test.tsx's `AiIntegrationPanel`.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ModuleSetupContent, SetupStep } from "@/lib/modules";
import AdminModuleSetup, { moduleSummary, panelSteps, setupComplete, setupStepStatus } from "@/components/admin-module-setup";

const setup: ModuleSetupContent = {
  experience: "Contestants answer questions on the quiz page and are graded on submit.",
  steps: [
    { title: "Enable the module", where: "outside", body: "Add it under modules in event.yaml, or switch it on from the Event tab." },
    { title: "Author at least one question", where: "panel", check: { count: "items", noun: "questions" } },
    { title: "Add a category", where: "panel", check: { count: "categories", noun: "categories", one: "category" } },
  ],
  midEvent: {
    safe: ["Changing the retry knobs."],
    unsafe: [[{ strong: "Changing a correct answer." }, " It redefines what counts for everyone."]],
  },
  docs: { href: "https://example.test/operations#quiz", label: "Quiz in the operations guide" },
};

describe("setupStepStatus", () => {
  it("has no status for a step the panel cannot check", () => {
    expect(setupStepStatus(setup.steps[0], undefined)).toBeNull();
    expect(setupStepStatus(setup.steps[0], { items: 3 })).toBeNull();
  });

  it("is unknown until the count has loaded, never a tick or a cross", () => {
    expect(setupStepStatus(setup.steps[1], undefined)).toBe("unknown");
    expect(setupStepStatus(setup.steps[1], { categories: 2 })).toBe("unknown");
  });

  it("is todo at zero and done at one or more", () => {
    expect(setupStepStatus(setup.steps[1], { items: 0 })).toBe("todo");
    expect(setupStepStatus(setup.steps[1], { items: 1 })).toBe("done");
    expect(setupStepStatus(setup.steps[2], { categories: 4 })).toBe("done");
  });
});

describe("setupComplete / panelSteps / moduleSummary", () => {
  it("is null while a count is unknown, false with a todo, true once every check is done", () => {
    expect(setupComplete(setup, undefined)).toBeNull();
    expect(setupComplete(setup, { items: 3, categories: 0 })).toBe(false);
    expect(setupComplete(setup, { items: 3, categories: 1 })).toBe(true);
  });

  it("counts a setup with nothing checkable as complete — nothing to expand for", () => {
    expect(setupComplete({ ...setup, steps: [setup.steps[0]] }, undefined)).toBe(true);
  });

  it("lists only the steps done in this panel", () => {
    expect(panelSteps(setup).map((s) => s.title)).toEqual(["Author at least one question", "Add a category"]);
  });

  it("phrases the status line from the same rule", () => {
    expect(moduleSummary(setup, undefined)).toBe("checking…");
    expect(moduleSummary(setup, { items: 0, categories: 0 })).toBe("setup incomplete");
    expect(moduleSummary(setup, { items: 3, categories: 1 })).toBe("setup complete · 3 questions · 1 category");
    expect(moduleSummary(undefined, undefined)).toBe("enabled");
    expect(moduleSummary({ ...setup, steps: [setup.steps[0]] }, undefined)).toBe("enabled");
  });
});

describe("AdminModuleSetup", () => {
  it("answers the questions in order: status, experience, steps, docs, then the mid-event help", () => {
    const html = renderToStaticMarkup(<AdminModuleSetup title="Quiz" setup={setup} />);
    const at = (s: string) => {
      const i = html.indexOf(s);
      expect(i, `missing: ${s}`).toBeGreaterThan(-1);
      return i;
    };
    expect(at("Checking…")).toBeLessThan(at("Setting up Quiz"));
    expect(at("Setting up Quiz")).toBeLessThan(at("Contestants answer questions"));
    expect(at("Contestants answer questions")).toBeLessThan(at("Author at least one question"));
    expect(at("Author at least one question")).toBeLessThan(at('href="https://example.test/operations#quiz"'));
    expect(at('href="https://example.test/operations#quiz"')).toBeLessThan(at("Changing the retry knobs."));
    expect(at("Changing the retry knobs.")).toBeLessThan(at("Changing a correct answer."));
    expect(html).toContain("Quiz in the operations guide");
  });

  it("does not repeat steps done outside the panel — the module is enabled, so they are behind the organizer", () => {
    const html = renderToStaticMarkup(<AdminModuleSetup title="Quiz" setup={setup} />);
    expect(html).not.toContain("Enable the module");
    expect(html).not.toContain("switch it on from the Event tab");
    expect(html).toContain("One provisioning step done outside this panel is not repeated here");
    // No "in / outside this panel" badges any more: every listed step is in
    // this panel.
    expect(html).not.toContain("Outside this panel");
    expect(html).not.toContain("In this panel");
  });

  it("renders copy through the shared segment renderer", () => {
    const html = renderToStaticMarkup(<AdminModuleSetup title="Quiz" setup={setup} />);
    expect(html).toContain('<span class="text-white">Changing a correct answer.</span>');
  });

  it("shows checking, not a false negative, before the counts have loaded", () => {
    const html = renderToStaticMarkup(<AdminModuleSetup title="Quiz" setup={setup} />);
    // The status line plus one per checkable step.
    expect(html.match(/Checking…/g)?.length).toBe(3);
    expect(html).not.toContain("None yet");
  });

  it("reflects the live counts once loaded", () => {
    const html = renderToStaticMarkup(<AdminModuleSetup title="Quiz" setup={setup} inventory={{ items: 3, categories: 0 }} />);
    expect(html).toContain("3 questions");
    expect(html).toContain("None yet");
    expect(html).not.toContain("Checking…");
  });

  it("uses the singular noun for one", () => {
    const step: SetupStep = { title: "x", where: "panel", check: { count: "items", noun: "questions", one: "question" } };
    const html = renderToStaticMarkup(<AdminModuleSetup title="Quiz" setup={{ ...setup, steps: [step] }} inventory={{ items: 1 }} />);
    expect(html).toContain("1 question");
    expect(html).not.toContain("1 questions");
  });

  it("opens the checklist while a step is still to do, and collapses it to the status line once every check is done", () => {
    const todo = renderToStaticMarkup(<AdminModuleSetup title="Quiz" setup={setup} inventory={{ items: 3, categories: 0 }} />);
    expect(todo).toMatch(/<details open=""[^>]*>[\s\S]*Setup incomplete · 3 questions/);
    const done = renderToStaticMarkup(<AdminModuleSetup title="Quiz" setup={setup} inventory={{ items: 3, categories: 1 }} />);
    expect(done).not.toContain("<details open");
    expect(done).toContain("Setup complete · 3 questions · 1 category");
    // Collapsed or not, the whole checklist stays in the markup.
    expect(done).toContain("Setting up Quiz");
    expect(done).toContain("Author at least one question");
  });

  it("stays collapsed while the counts are unknown — never accuses on first paint", () => {
    const html = renderToStaticMarkup(<AdminModuleSetup title="Quiz" setup={setup} />);
    expect(html).not.toContain("<details open");
    expect(html).toContain("Checking…");
  });

  it("keeps the mid-event help in its own closed drawer", () => {
    const html = renderToStaticMarkup(<AdminModuleSetup title="Quiz" setup={setup} />);
    expect(html).toContain("What is safe to change mid-event");
    expect(html.match(/<details/g)?.length).toBe(2);
    expect(html).toContain("Safe to change mid-event");
    expect(html).toContain("Not safe mid-event");
  });
});
