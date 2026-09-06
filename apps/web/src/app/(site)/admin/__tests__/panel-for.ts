// Test helper (not a suite — the filename deliberately has no `.test.`, so
// vitest's default include pattern skips it).
//
// The admin panel renders EVERY tab panel into the DOM and hides the inactive
// ones with the `hidden` attribute, so `renderToStaticMarkup` output contains
// all of them at once. An assertion like `expect(html).toContain("Hint cost")`
// therefore proves nothing about WHICH panel the control landed in. `panelFor`
// narrows the markup to one panel — from its own `role="region"` marker up
// to the next one — so a control that drifts into the wrong tab fails.

/**
 * Slice `html` down to the markup of the tab panel whose id is `panel-<id>`.
 *
 * Throws rather than returning "" when the panel is absent: a missing panel is
 * a bug in the component, and silently returning an empty string would turn
 * every `not.toContain` assertion into a vacuous pass.
 */
export function panelFor(html: string, id: string): string {
  const anchor = html.indexOf(`id="panel-${id}"`);
  if (anchor === -1) {
    throw new Error(`panelFor: no tab panel with id="panel-${id}" in the rendered markup`);
  }
  // The opening tag is `<div role="region" id="panel-…" …>`, so the panel
  // starts at the marker preceding its id and ends at the next marker (or at
  // the end of the markup, for the last panel).
  const start = html.lastIndexOf('role="region"', anchor);
  const end = html.indexOf('role="region"', anchor);
  return html.slice(start === -1 ? anchor : start, end === -1 ? html.length : end);
}
