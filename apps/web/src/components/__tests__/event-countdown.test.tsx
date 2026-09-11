// EventCountdown's `startsAt` prop replaced a direct read of the (now-dead)
// event.yaml bake's start date (config v2, PR 3A) — the component itself
// now renders nothing for a null or unparseable bound, rather than trusting
// every caller to pre-guard it. `renderToStaticMarkup` never runs
// `useEffect`, so every case here
// exercises the "not mounted yet" placeholder render, same as the other
// components in this directory that mount a client component statically.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import EventCountdown from "@/components/event-countdown";

describe("EventCountdown", () => {
  it("renders nothing when startsAt is null", () => {
    const html = renderToStaticMarkup(<EventCountdown startsAt={null} />);
    expect(html).toBe("");
  });

  it("renders nothing when startsAt does not parse as a date", () => {
    const html = renderToStaticMarkup(<EventCountdown startsAt="not-a-date" />);
    expect(html).toBe("");
  });

  it("renders the hero countdown for a valid startsAt", () => {
    const html = renderToStaticMarkup(<EventCountdown startsAt="2026-10-01T09:00:00Z" />);
    expect(html).toContain("CTF opens");
  });

  it("renders the compact variant for a valid startsAt", () => {
    const html = renderToStaticMarkup(
      <EventCountdown startsAt="2026-10-01T09:00:00Z" variant="compact" hideWhenComplete />,
    );
    expect(html).toContain("days");
  });
});
