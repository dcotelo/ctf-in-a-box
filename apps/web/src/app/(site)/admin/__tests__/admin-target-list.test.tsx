// `nextTargets` is a pure function (no hooks, no DOM) — the checkbox
// contract from `checkSecureDevTargets` (server) and `TargetsCheck` mirrored
// client-side so a change never round-trips to the server just to be
// refused. The render assertions use `renderToStaticMarkup` — this repo has
// no @testing-library — and only check markup, since `AdminTargetList`'s
// `onChange` is exercised end-to-end through `nextTargets`'s own unit tests
// rather than by firing a synthetic event (see admin-module-identity.binding
// .test.tsx for why a DOM event would need the Probe trick and isn't needed
// here: the handler is a one-line call into `nextTargets` plus `applyField`,
// with nothing of its own left to prove once both are pinned separately).
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AppId } from "@/lib/apps";
import { TARGET_IDS } from "@/lib/secure-dev-targets";
import AdminTargetList, { nextTargets } from "@/app/(site)/admin/admin-target-list";

describe("nextTargets", () => {
  it("adds a target and keeps catalogue order regardless of click order", () => {
    // dvwa comes before juice-shop in the catalogue (lib/apps.ts); checking
    // juice-shop from a dvwa-only list must not append it after dvwa.
    expect(nextTargets(["dvwa"], "juice-shop", true)).toEqual(
      TARGET_IDS.filter((id) => id === "dvwa" || id === "juice-shop"),
    );
  });

  it("removes a target, keeping the rest in catalogue order", () => {
    const current = TARGET_IDS.slice(0, 3) as AppId[];
    expect(nextTargets(current, current[1], false)).toEqual([current[0], current[2]]);
  });

  it("returns null when unchecking the last remaining target", () => {
    expect(nextTargets(["vampi"], "vampi", false)).toBeNull();
  });

  it("is a no-op shape when checking an already-checked id (idempotent)", () => {
    expect(nextTargets(["dvwa", "vampi"], "dvwa", true)).toEqual(["dvwa", "vampi"]);
  });
});

describe("AdminTargetList", () => {
  const statusOf = () => ({ state: "idle" as const });

  it("renders all six targets as checkboxes named secureDevTargets, in catalogue order", () => {
    const html = renderToStaticMarkup(
      <AdminTargetList targets={["dvwa"]} pending={false} statusOf={statusOf} applyField={vi.fn()} />,
    );
    const matches = [...html.matchAll(/<input[^>]*name="secureDevTargets"[^>]*>/g)];
    expect(matches).toHaveLength(TARGET_IDS.length);
    // Catalogue order: each id's checkbox appears before the next one's.
    let lastIndex = -1;
    for (const id of TARGET_IDS) {
      const at = html.indexOf(`id="target-${id}"`);
      expect(at).toBeGreaterThan(lastIndex);
      lastIndex = at;
    }
  });

  it("checks exactly the given targets and disables only the sole remaining one", () => {
    const html = renderToStaticMarkup(
      <AdminTargetList targets={["dvwa"]} pending={false} statusOf={statusOf} applyField={vi.fn()} />,
    );
    const dvwaInput = html.match(/<input[^>]*id="target-dvwa"[^>]*>/)?.[0];
    expect(dvwaInput).toBeDefined();
    expect(dvwaInput).toContain("checked=");
    expect(dvwaInput).toContain("disabled=");

    for (const id of TARGET_IDS.filter((t) => t !== "dvwa")) {
      const input = html.match(new RegExp(`<input[^>]*id="target-${id}"[^>]*>`))?.[0];
      expect(input).toBeDefined();
      expect(input).not.toContain("checked=");
      expect(input).not.toContain("disabled=");
    }
  });

  it("disables no box when more than one target is checked", () => {
    const html = renderToStaticMarkup(
      <AdminTargetList targets={["dvwa", "vampi"]} pending={false} statusOf={statusOf} applyField={vi.fn()} />,
    );
    for (const id of ["dvwa", "vampi"] as const) {
      const input = html.match(new RegExp(`<input[^>]*id="target-${id}"[^>]*>`))?.[0];
      expect(input).not.toContain("disabled=");
    }
  });

  // Fix round 1 (Task 4 review): the lead sentence ("Which targets this
  // event runs…") must be a programmatic description of every checkbox, not
  // just readable prose above them — otherwise a screen-reader user tabbing
  // through the six boxes never hears it.
  it("describes every checkbox by the list's lead help sentence", () => {
    const html = renderToStaticMarkup(
      <AdminTargetList targets={["dvwa"]} pending={false} statusOf={statusOf} applyField={vi.fn()} />,
    );
    for (const id of TARGET_IDS) {
      const input = html.match(new RegExp(`<input[^>]*id="target-${id}"[^>]*>`))?.[0];
      expect(input).toBeDefined();
      const describedBy = input!.match(/aria-describedby="([^"]*)"/)?.[1];
      expect(describedBy).toBeDefined();
      expect(describedBy!.split(" ")).toContain("secure-dev-targets-help");
    }
  });

  it("labels each row with the app's catalogue name", () => {
    const html = renderToStaticMarkup(
      <AdminTargetList targets={["dvwa"]} pending={false} statusOf={statusOf} applyField={vi.fn()} />,
    );
    expect(html).toContain('<label for="target-dvwa"');
    expect(html).toContain("DVWA");
    expect(html).toContain('<label for="target-securityshepherd"');
    expect(html).toContain("Security Shepherd");
  });
});
