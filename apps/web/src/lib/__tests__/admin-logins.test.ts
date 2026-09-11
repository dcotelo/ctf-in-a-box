import { describe, expect, it } from "vitest";
import { countInvalidAdminLogins, parseAdminLogins } from "@/lib/admin-logins";

describe("parseAdminLogins", () => {
  it("lower-cases, trims, drops empties and dedupes", () => {
    expect([...parseAdminLogins("  Alice, bob,,ALICE ")]).toEqual(["alice", "bob"]);
  });

  it("undefined, empty and whitespace mean nobody", () => {
    for (const v of [undefined, "", " , ,"]) expect(parseAdminLogins(v).size).toBe(0);
  });

  // R1 (plan): "ADMIN_LOGINS empty or unparseable → nobody is admin". An
  // entry that is not shaped like a GitHub login (LOGIN_RE, the same rule
  // the runtime-grant write path enforces) can never match a real session
  // login, so it is dropped rather than silently counted as a configured
  // admin.
  it("junk-only input (nothing GitHub-login-shaped) yields an empty set", () => {
    expect(parseAdminLogins("alice@example.com, -bob, carol-, d--e").size).toBe(0);
  });

  it("mixed input keeps only the entries shaped like a GitHub login", () => {
    expect([...parseAdminLogins("alice@example.com, Bob, -carol, dave")]).toEqual(["bob", "dave"]);
  });
});

describe("countInvalidAdminLogins", () => {
  it("is 0 for unset, empty, and comma-only input — no entries to be wrong", () => {
    for (const v of [undefined, "", " , ,"]) expect(countInvalidAdminLogins(v)).toBe(0);
  });

  it("is 0 when every non-empty entry parses as a login", () => {
    expect(countInvalidAdminLogins("Alice, bob")).toBe(0);
  });

  // The M6 case: a typo'd email address parses to an empty set (the wall's
  // "empty" wording used to be misleading here), but it is one dropped
  // entry, not zero.
  it("counts each non-login-shaped entry once", () => {
    expect(countInvalidAdminLogins("alice@example.com, -bob, carol-, d--e")).toBe(4);
  });

  it("counts only the invalid entries in a mixed list", () => {
    expect(countInvalidAdminLogins("alice@example.com, Bob, -carol, dave")).toBe(2);
  });
});
