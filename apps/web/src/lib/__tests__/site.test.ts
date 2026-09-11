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
  // Finding M1: an empty stored eventName (only reachable by a hand-run HSET
  // — the app's own write path already rejects "") must still fall back to
  // the default rather than render a blank <title>/headline. The other four
  // identity fields keep their existing "'' is a legitimate no-override" `??`
  // semantics — pinned here with eventTheme so a future edit can't collapse
  // `||` onto every field by mistake.
  it("falls back to the default name on an empty stored eventName, but leaves the other fields' blank-is-valid semantics alone", () => {
    expect(resolveSite({ eventName: "" }).name).toBe("OWASP CTF");
    expect(resolveSite({ eventTheme: "" }).theme).toBe("");
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
