import { describe, expect, it } from "vitest";
import { MUTATING_METHODS, originAllowed } from "../origin";

const EVENT = "https://ctf.example.org";

describe("originAllowed", () => {
  it("allows the event's own origin", () => {
    expect(originAllowed({ origin: EVENT, configuredUrl: EVENT })).toBe(true);
  });

  it("refuses another site's origin", () => {
    expect(originAllowed({ origin: "https://evil.example", configuredUrl: EVENT })).toBe(false);
  });

  // The near-misses an attacker actually tries, and the ones a naive
  // `startsWith` or substring compare would wave through.
  it.each([
    "https://ctf.example.org.evil.example",
    "https://evil.example/?x=https://ctf.example.org",
    "http://ctf.example.org",
    "https://ctf.example.org:8443",
  ])("refuses %s", (origin) => {
    expect(originAllowed({ origin, configuredUrl: EVENT })).toBe(false);
  });

  it("ignores a path or trailing slash on the configured URL", () => {
    // docker-compose passes EVENT_URL through verbatim; an organizer's
    // trailing slash must not start refusing every write on the event.
    expect(originAllowed({ origin: EVENT, configuredUrl: `${EVENT}/` })).toBe(true);
    expect(originAllowed({ origin: EVENT, configuredUrl: `${EVENT}/api/auth` })).toBe(true);
  });

  it("allows a request with no Origin header", () => {
    // A non-browser client carries no ambient session cookie, so it cannot
    // mount the attack this defends against; refusing would break curl and
    // health checks for no gain.
    expect(originAllowed({ origin: null, configuredUrl: EVENT })).toBe(true);
    expect(originAllowed({ origin: undefined, configuredUrl: EVENT })).toBe(true);
  });

  it("allows when there is nothing to compare against", () => {
    // Deriving the expectation from the request's own Host header would let
    // an attacker satisfy the check by setting it.
    expect(originAllowed({ origin: "https://evil.example", configuredUrl: undefined })).toBe(true);
    expect(originAllowed({ origin: "https://evil.example", configuredUrl: "not a url" })).toBe(true);
  });

  it("refuses a present but unparseable Origin", () => {
    expect(originAllowed({ origin: "://nonsense", configuredUrl: EVENT })).toBe(false);
  });

  it("treats exactly the state-changing methods as mutating", () => {
    expect([...MUTATING_METHODS].sort()).toEqual(["DELETE", "PATCH", "POST", "PUT"]);
    expect(MUTATING_METHODS.has("GET")).toBe(false);
    expect(MUTATING_METHODS.has("HEAD")).toBe(false);
  });
});
