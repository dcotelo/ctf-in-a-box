// The "updated Ns ago · refreshes every 15 s" stamp. Its visible output is
// behind a mount effect (a clock read during render would trip hydration),
// so the static render is asserted to be EMPTY in both pre-load states and
// the wording is driven through the exported pure helpers.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import AdminLiveStamp, { describeAge, describeCadence } from "@/app/(site)/admin/admin-live-stamp";

describe("AdminLiveStamp", () => {
  it("renders nothing before a first load has landed", () => {
    expect(renderToStaticMarkup(<AdminLiveStamp updatedAt={null} live intervalMs={15_000} />)).toBe("");
  });

  it("renders nothing on the server even with a load stamped — the age is a client clock read", () => {
    expect(renderToStaticMarkup(<AdminLiveStamp updatedAt={Date.now()} live intervalMs={15_000} />)).toBe("");
  });
});

describe("describeAge", () => {
  const t0 = Date.parse("2026-08-24T18:00:00.000Z");

  it("counts seconds under a minute — the whole signal on a polled screen", () => {
    expect(describeAge(t0, t0)).toBe("0s ago");
    expect(describeAge(t0, t0 + 12_400)).toBe("12s ago");
    expect(describeAge(t0, t0 + 59_999)).toBe("59s ago");
  });

  it("hands off to the shared relative-time scale from a minute up", () => {
    expect(describeAge(t0, t0 + 60_000)).toBe("1m ago");
    expect(describeAge(t0, t0 + 3 * 3_600_000)).toBe("3h ago");
  });

  it("never goes negative when the clocks disagree", () => {
    expect(describeAge(t0 + 5000, t0)).toBe("0s ago");
  });
});

describe("describeCadence", () => {
  it("names the interval while live", () => {
    expect(describeCadence(true, 15_000)).toBe("refreshes every 15 s");
    expect(describeCadence(true, 30_000)).toBe("refreshes every 30 s");
  });

  it("says the loop is off, in words, when the event is not live", () => {
    expect(describeCadence(false, 15_000)).toBe("auto-refresh paused while the event is not live");
  });
});
