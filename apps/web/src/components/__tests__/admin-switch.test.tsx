// @testing-library/react is not a dependency of this repo and must not be
// added just for this test. AdminSwitch is presentational — the value and
// the save status arrive as props from the shell — so `renderToStaticMarkup`
// can show it in every state an organizer can see it in, the same way
// admin-number-field.test.tsx does for the numeric knob it shares its status
// line with.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import AdminSwitch from "@/components/admin-switch";

const base = {
  id: "event-paused",
  label: "Freeze scoring",
  help: "Pause new submissions from being scored.",
  disabled: false,
  onChange: () => {},
};

describe("AdminSwitch", () => {
  it("is a real switch: a checkbox input with role=switch and aria-checked mirroring checked", () => {
    const on = renderToStaticMarkup(<AdminSwitch {...base} checked status={{ state: "idle" }} />);
    expect(on).toContain('type="checkbox"');
    expect(on).toContain('role="switch"');
    expect(on).toMatch(/aria-checked="true"[^>]*checked=""/);
    expect(on).toContain("Freeze scoring");
    expect(on).toContain("Pause new submissions");

    const off = renderToStaticMarkup(<AdminSwitch {...base} checked={false} status={{ state: "idle" }} />);
    expect(off).toContain('aria-checked="false"');
    expect(off).not.toContain('checked=""');
  });

  it("keeps the input in the accessibility tree while the track is decoration", () => {
    const html = renderToStaticMarkup(<AdminSwitch {...base} checked status={{ state: "idle" }} />);
    // The input is visually hidden, not display:none — display:none would
    // drop it from the tab order and the label association.
    expect(html).toMatch(/<input[^>]*class="peer sr-only"/);
    expect(html).toMatch(/aria-hidden="true"[^>]*peer-checked/);
  });

  it("says nothing while idle", () => {
    const html = renderToStaticMarkup(<AdminSwitch {...base} checked status={{ state: "idle" }} />);
    expect(html).not.toContain("Saving");
    expect(html).not.toContain("Saved");
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("aria-describedby");
  });

  it("says Saving while the write is in flight and Saved once it lands", () => {
    expect(renderToStaticMarkup(<AdminSwitch {...base} checked status={{ state: "pending" }} />)).toContain("Saving…");
    expect(renderToStaticMarkup(<AdminSwitch {...base} checked status={{ state: "saved" }} />)).toContain("Saved");
  });

  it("announces a refusal beside the row and ties it to the input", () => {
    const html = renderToStaticMarkup(
      <AdminSwitch {...base} checked status={{ state: "rejected", message: "Freeze scoring could not be saved: settings write failed" }} />,
    );
    expect(html).toContain("Freeze scoring could not be saved: settings write failed");
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="event-paused-status"');
    expect(html).toContain('id="event-paused-status"');
  });

  it("renders a disabled row with its reason, greyed only when off", () => {
    const offDisabled = renderToStaticMarkup(
      <AdminSwitch {...base} checked={false} disabled help="Configured at setup." status={{ state: "idle" }} />,
    );
    expect(offDisabled).toContain('disabled=""');
    expect(offDisabled).toContain("Configured at setup.");
    expect(offDisabled).toMatch(/class="text-zinc-400">Freeze scoring/);
    // On but locked (the last live module) keeps the white label: it is
    // live, just not switchable.
    const onDisabled = renderToStaticMarkup(<AdminSwitch {...base} checked disabled status={{ state: "idle" }} />);
    expect(onDisabled).toMatch(/class="text-white">Freeze scoring/);
  });
});
