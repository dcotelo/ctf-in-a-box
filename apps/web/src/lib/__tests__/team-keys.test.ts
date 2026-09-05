// The shared team-key builders (ADR 48) and the one reader that used to
// open-code them. team-keys.ts exists because profile/page.tsx read the team
// hash as a literal `ctf:team:${slug}` — with a comment admitting it — and
// open-coded key strings are how two readers of the same data drift apart.
// The key shapes are pinned here so a rename in team-keys.ts cannot silently
// move the team data out from under team-store.ts's Lua scripts, which name
// the same keys as literals; the source scan pins that the page stays on the
// builder rather than growing a fresh literal.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { joinCodeKey, membersKey, teamKey, userKey } from "@/lib/team-keys";

describe("team key names", () => {
  it("namespaces the team hash, its member set and the reverse index", () => {
    expect(teamKey("alpha")).toBe("ctf:team:alpha");
    expect(membersKey("alpha")).toBe("ctf:team:alpha:members");
    expect(joinCodeKey("abc123")).toBe("ctf:joincode:abc123");
    expect(userKey("Alice")).toBe("ctf:user:Alice");
  });
});

describe("profile/page.tsx reads the team hash through teamKey", () => {
  // The page this file's header quotes. Read from disk rather than imported:
  // the assertion is about the SOURCE (which key string it names), not about
  // what the module exports, and importing the page would pull in its whole
  // Server Component dependency graph for a string check.
  const source = readFileSync(new URL("../../app/(site)/profile/page.tsx", import.meta.url), "utf8");

  it("reads the page — the reader is asserted, not just its output", () => {
    // A moved or renamed page would read as an ENOENT, not a silent pass; a
    // wrong path that still resolves would fail this instead of leaving the
    // negative assertion below to pass against the wrong file.
    expect(source).toContain("async function getTeamMeta(");
  });

  it("open-codes no ctf:team: literal", () => {
    expect(source).not.toMatch(/ctf:team:/);
  });

  it("imports teamKey from the shared team-keys module and calls it", () => {
    // `@/lib/team-keys`, not `@/lib/team-store`: the store keeps its own
    // module-private copies and re-exports nothing, and the other readers
    // (hint-store, metrics-store, admin-ops-store) all import team-keys.
    expect(source).toMatch(/import \{[^}]*\bteamKey\b[^}]*\} from "@\/lib\/team-keys";/);
    expect(source).toContain("teamKey(");
  });
});
