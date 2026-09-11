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
});
