import { describe, expect, it } from "vitest";
import { checkEventUrl } from "../secure-url";

// The failure this guards is silent by construction: an organizer edits
// EVENT_URL's host and not its scheme, the app starts normally, sign-in works
// normally, and the only difference is that every session cookie — including
// theirs — is now sniffable on the venue's wifi. There is no symptom to
// notice until somebody uses it.

const prod = { nodeEnv: "production" };
const dev = { nodeEnv: "development" };

describe("checkEventUrl", () => {
  it("passes an https event URL", () => {
    expect(checkEventUrl({ url: "https://ctf.example.org", ...prod }).level).toBe("ok");
  });

  it("refuses to start production on plain HTTP to a real host", () => {
    const v = checkEventUrl({ url: "http://ctf.example.org", ...prod });
    expect(v.level).toBe("fail");
    // The message has to carry the fix, not just the diagnosis — it is read
    // in a container log by somebody whose event is down.
    expect(v.message).toContain("http://ctf.example.org");
    expect(v.message).toContain("EVENT_URL");
    expect(v.message).toContain("ALLOW_INSECURE_EVENT_URL");
  });

  // Every loopback spelling must pass: `http://localhost` is the shipped
  // .env.example default and what CI builds with, so a guard that rejected any
  // of these would break the local trial it is supposed to leave alone.
  it.each([
    "http://localhost",
    "http://localhost:3000",
    "http://ctf.localhost",
    "http://127.0.0.1:3000",
    "http://[::1]:3000",
  ])("leaves %s alone", (url) => {
    expect(checkEventUrl({ url, ...prod }).level).toBe("ok");
  });

  it("warns but does not block outside production", () => {
    // An organizer pointing a LAN address at the box to test from a phone is
    // doing something legitimate. Tell them; don't stop them.
    const v = checkEventUrl({ url: "http://192.168.1.20:3000", ...dev });
    expect(v.level).toBe("warn");
    expect(v.message).toContain("Secure");
  });

  it("downgrades to a loud warning when the escape hatch is set", () => {
    const v = checkEventUrl({ url: "http://ctf.lab.internal", ...prod, allowInsecure: true });
    expect(v.level).toBe("warn");
    expect(v.message).toContain("sniffable by design");
  });

  it("warns when BETTER_AUTH_URL is unset in production but starts clean in dev", () => {
    expect(checkEventUrl({ url: undefined, ...prod }).level).toBe("warn");
    expect(checkEventUrl({ url: undefined, ...dev }).level).toBe("ok");
  });

  it("warns rather than failing on an unparseable or unexpected URL", () => {
    // A malformed value is a config typo, not a security decision. Failing
    // shut on it would take an event down for something the guard cannot
    // actually reason about.
    expect(checkEventUrl({ url: "not a url", ...prod }).level).toBe("warn");
    expect(checkEventUrl({ url: "ftp://ctf.example.org", ...prod }).level).toBe("warn");
  });
});
