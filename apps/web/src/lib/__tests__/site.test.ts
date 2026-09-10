import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getAdminSettingsSnapshot: vi.fn() }));
vi.mock("@/lib/enabled-modules", () => ({ getAdminSettingsSnapshot: mocks.getAdminSettingsSnapshot }));

import { getSite, resolveSite } from "@/lib/site";
import { eventConfig } from "@/lib/event-config";

beforeEach(() => mocks.getAdminSettingsSnapshot.mockReset());

describe("resolveSite", () => {
  it("serves the spec defaults when nothing is stored", () => {
    const s = resolveSite(null);
    expect(s.name).toBe("OWASP CTF");
    expect(s.theme).toBe("");
    expect(s.location).toBe("");
    expect(s.contactEmail).toBe("");
    expect(s.discordUrl).toBe("");
  });
  it("lays stored fields over the defaults, field by field", () => {
    const s = resolveSite({ eventName: "Demo CTF", eventDiscord: "https://discord.gg/x" });
    expect(s.name).toBe("Demo CTF");
    expect(s.discordUrl).toBe("https://discord.gg/x");
    expect(s.theme).toBe("");
  });
  it("still reads dates and ctfStartsAt from event.yaml until PR 3", () => {
    const s = resolveSite({});
    expect(s.dates).toBe(eventConfig.dates);
    expect(s.ctfStartsAt).toBe(eventConfig.ctfStartsAt);
  });
  it("keeps the OWASP policy urls static", () => {
    expect(resolveSite(null).owaspPrivacyUrl).toMatch(/^https:\/\/policy\.owasp\.org\//);
    expect(resolveSite(null).privacyContactEmail).toBe("privacy@owasp.com");
  });
});

describe("getSite", () => {
  it("reads identity off the shared settings snapshot", async () => {
    mocks.getAdminSettingsSnapshot.mockResolvedValue({ eventIdentity: { eventName: "Snapshot CTF" } });
    expect((await getSite()).name).toBe("Snapshot CTF");
    expect(mocks.getAdminSettingsSnapshot).toHaveBeenCalledTimes(1);
  });
  it("fails open to the defaults when the snapshot is null", async () => {
    mocks.getAdminSettingsSnapshot.mockResolvedValue(null);
    expect((await getSite()).name).toBe("OWASP CTF");
  });
});
