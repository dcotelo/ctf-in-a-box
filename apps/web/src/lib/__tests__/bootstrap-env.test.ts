import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { envAdmins, getGithubOrg } from "@/lib/bootstrap-env";

describe("getGithubOrg", () => {
  it("trims the configured org", () => {
    expect(getGithubOrg({ GITHUB_ORG: "  org " })).toBe("org");
  });

  it("is '' when unset — R2: may be empty, no baked default", () => {
    expect(getGithubOrg({})).toBe("");
  });
});

describe("envAdmins", () => {
  it("parses ADMIN_LOGINS through parseAdminLogins (lower-case, trim, dedupe)", () => {
    expect([...envAdmins({ ADMIN_LOGINS: "Alice,bob" })]).toEqual(["alice", "bob"]);
  });

  it("is empty when ADMIN_LOGINS is unset", () => {
    expect(envAdmins({}).size).toBe(0);
  });

  // M6: a typo'd ADMIN_LOGINS still parses to a set, but it should say HOW
  // MANY entries it dropped — never the entries themselves, which could be
  // an email address or something else the organizer would not want in a
  // log.
  it("does not warn when every entry parses", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    envAdmins({ ADMIN_LOGINS: "Alice,bob" });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("warns once with only the COUNT of dropped entries — never the raw values", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    envAdmins({ ADMIN_LOGINS: "alice@example.com, bob, -carol" });
    expect(spy).toHaveBeenCalledTimes(1);
    const [line] = spy.mock.calls[0];
    expect(line).toContain("2");
    expect(line).not.toContain("alice@example.com");
    expect(line).not.toContain("-carol");
    spy.mockRestore();
  });
});
