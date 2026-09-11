import { describe, expect, it } from "vitest";
import { parseAdminLogins } from "@/lib/admin-logins";

describe("parseAdminLogins", () => {
  it("lower-cases, trims, drops empties and dedupes", () => {
    expect([...parseAdminLogins("  Alice, bob,,ALICE ")]).toEqual(["alice", "bob"]);
  });

  it("undefined, empty and whitespace mean nobody", () => {
    for (const v of [undefined, "", " , ,"]) expect(parseAdminLogins(v).size).toBe(0);
  });
});
