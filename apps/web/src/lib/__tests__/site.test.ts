import { describe, expect, it } from "vitest";
import { event } from "@/lib/site";
import { eventConfig } from "@/lib/event-config";

describe("site event", () => {
  it("derives identity from eventConfig", () => {
    expect(event.name).toBe(eventConfig.name);
    expect(event.dates).toBe(eventConfig.dates);
    expect(event.location).toBe(eventConfig.location);
    expect(event.ctfStartsAt).toBe(eventConfig.ctfStartsAt);
  });
  it("keeps OWASP policy urls static", () => {
    expect(event.owaspPrivacyUrl).toMatch(/^https:\/\/policy\.owasp\.org\//);
  });
  it("tracks contactEmail from config, valid address when set", () => {
    // "" under neutral defaults is expected — pages hide contact lines in that case.
    expect(event.contactEmail).toBe(eventConfig.contactEmail);
    if (event.contactEmail) expect(event.contactEmail).toContain("@");
  });
});
