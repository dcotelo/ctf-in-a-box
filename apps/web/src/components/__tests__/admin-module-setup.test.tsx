// @testing-library/react is not a dependency of this repo and must not be
// added just for this test. AdminModuleSetup is purely presentational — every
// bit of state it shows (the module's setup content, the live counts) arrives
// as props — so `renderToStaticMarkup` sees exactly what an organizer sees,
// in whichever state the test hands it. Same pattern as
// admin-ai-integration.test.tsx's `AiIntegrationPanel`.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ModuleSetupContent, SetupStep } from "@/lib/modules";
import AdminModuleSetup, { setupStepStatus } from "@/components/admin-module-setup";

const setup: ModuleSetupContent = {
  experience: "Contestants answer questions on the quiz page and are graded on submit.",
  steps: [
    { title: "Enable the module", where: "outside", body: "Add it under modules in event.yaml, or switch it on from the Event tab." },
    { title: "Author at least one question", where: "panel", check: { count: "items", noun: "questions" } },
    { title: "Add a category", where: "panel", check: { count: "categories", noun: "categories" } },
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

describe("AdminModuleSetup", () => {
  it("answers the five questions in order: experience, steps, where, mid-event, docs", () => {
    const html = renderToStaticMarkup(<AdminModuleSetup title="Quiz" setup={setup} />);
    const at = (s: string) => {
      const i = html.indexOf(s);
      expect(i, `missing: ${s}`).toBeGreaterThan(-1);
      return i;
    };
    expect(at("Contestants answer questions")).toBeLessThan(at("Enable the module"));
    expect(at("Enable the module")).toBeLessThan(at("Author at least one question"));
    expect(at("Author at least one question")).toBeLessThan(at("Changing the retry knobs."));
    expect(at("Changing the retry knobs.")).toBeLessThan(at("Changing a correct answer."));
    expect(at("Changing a correct answer.")).toBeLessThan(at('href="https://example.test/operations#quiz"'));
    expect(html).toContain("Quiz in the operations guide");
  });

  it("says on every step whether it happens in this panel or outside it", () => {
    const html = renderToStaticMarkup(<AdminModuleSetup title="Quiz" setup={setup} />);
    expect(html.match(/Outside this panel/g)?.length).toBe(1);
    expect(html.match(/In this panel/g)?.length).toBe(2);
  });

  it("renders a step's body copy through the shared segment renderer", () => {
    const html = renderToStaticMarkup(<AdminModuleSetup title="Quiz" setup={setup} />);
    expect(html).toContain("switch it on from the Event tab");
    expect(html).toContain('<span class="text-white">Changing a correct answer.</span>');
  });

  it("shows checking, not a false negative, before the counts have loaded", () => {
    const html = renderToStaticMarkup(<AdminModuleSetup title="Quiz" setup={setup} />);
    expect(html.match(/Checking…/g)?.length).toBe(2);
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

  it("is collapsible but rendered open, so the markup carries the whole checklist", () => {
    const html = renderToStaticMarkup(<AdminModuleSetup title="Quiz" setup={setup} />);
    expect(html).toContain("<details");
    expect(html).toContain("open");
    expect(html).toContain("Setting up Quiz");
  });
});
