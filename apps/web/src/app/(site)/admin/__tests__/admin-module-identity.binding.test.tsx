// Proves the invariant admin-module-identity.test.ts's `commitIdentityField`
// suite structurally CANNOT: that the patch key POSTed on blur is the exact
// same string as the `name` attribute actually rendered on THIS field
// instance — not "the key is moduleTitle:quiz", but "the key equals
// props.name read off the very element the field returned".
//
// This repo has no testing-library and must not gain one (see
// AGENTS.md/CLAUDE.md conventions). `renderToStaticMarkup` alone can't help
// either: it serializes to an HTML string, discarding every event handler,
// so no test built on it can ever fire a blur. Instead: `Probe` calls
// `IdentityField` DIRECTLY — a plain function call, not JSX/createElement —
// from inside its OWN render body. React does not associate a hook call
// with the literal function that invoked it; it only cares which fiber is
// currently rendering. That's the exact mechanism a custom hook relies on
// (`useFoo()`'s `useState` attaches to whichever component called `useFoo`,
// not to `useFoo` itself), so this is standard hooks composition, not an
// internals hack: one synchronous render, one hook call, perfectly safe.
//
// The result is the actual React element `IdentityField` returns — a real
// `name` prop and a real `onBlur` closure, both produced by the SAME call.
// Firing that `onBlur` with a bare stub event and reading what `apply` was
// called with, then comparing against that same element's `name`, is what
// makes drift between the two impossible to pass unnoticed — unlike the
// admin-controls.test.tsx markup assertions (which never fire events) and
// unlike commitIdentityField's own unit tests (which take `patchKey` as an
// already-consistent argument, so they'd stay green even if IdentityField
// posted a different key than it renders).
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { IdentityField } from "@/app/(site)/admin/admin-module-identity";

type FieldProps = {
  name: string;
  onBlur: (e: { currentTarget: { value: string } }) => void;
};

function captureIdentityFieldElement(apply: (patch: Record<string, unknown>) => Promise<boolean>): ReactElement {
  let captured: ReactElement | null = null;
  function Probe() {
    captured = IdentityField({
      patchKey: "moduleTitle:quiz",
      stored: "Round 1",
      placeholder: "Quiz",
      maxLength: 60,
      disabled: false,
      multiline: false,
      apply,
    });
    return null;
  }
  renderToStaticMarkup(<Probe />);
  if (!captured) throw new Error("Probe never captured IdentityField's returned element");
  return captured;
}

describe("IdentityField name/onBlur binding", () => {
  it("POSTs a patch keyed EXACTLY by this element's own rendered `name` — not a hardcoded string", () => {
    const apply = vi.fn().mockResolvedValue(true);
    const el = captureIdentityFieldElement(apply);
    const props = el.props as FieldProps;

    expect(props.name).toBe("moduleTitle:quiz"); // sanity: this IS the field we think it is

    props.onBlur({ currentTarget: { value: "Round 2" } });

    // The invariant: whatever `name` this element rendered is the key
    // `apply` was called with — read off the SAME element, not re-typed.
    expect(apply).toHaveBeenCalledWith({ [props.name]: "Round 2" });
  });
});
