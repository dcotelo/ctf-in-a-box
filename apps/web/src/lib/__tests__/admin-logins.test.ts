import { describe, expect, it } from "vitest";
import { parseAdminLogins } from "@/lib/admin-logins";

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
