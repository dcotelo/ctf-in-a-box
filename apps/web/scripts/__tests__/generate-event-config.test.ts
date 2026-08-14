import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(__dirname, "..", "generate-event-config.mjs");

function generate(env: Record<string, string>, yaml?: string) {
  const dir = mkdtempSync(join(tmpdir(), "evcfg-"));
  const out = join(dir, "generated.ts");
  const fullEnv: Record<string, string> = { ...process.env, OUT_PATH: out } as never;
  for (const k of Object.keys(fullEnv)) if (k.startsWith("EVENT_")) delete fullEnv[k];
  Object.assign(fullEnv, env);
  if (yaml !== undefined) {
    const cfg = join(dir, "event.yaml");
    writeFileSync(cfg, yaml);
    fullEnv.EVENT_CONFIG = cfg;
  }
  execFileSync("node", [SCRIPT], { env: fullEnv });
  return readFileSync(out, "utf8");
}

describe("generate-event-config", () => {
  it("defaults are neutral OWASP CTF with all six targets", () => {
    const out = generate({});
    expect(out).toContain(`"name": "OWASP CTF"`);
    expect(out).toContain(`"ctfStartsAt": null`);
    expect(out).not.toMatch(/DEF CON|DC34|Las Vegas/i);
    for (const t of ["juice-shop", "dvwa", "webgoat", "securityshepherd", "vulnerableapp", "vampi"])
      expect(out).toContain(`"${t}"`);
  });

  it("reads the kit event.yaml schema", () => {
    const out = generate({}, [
      'event: { name: "Chapter CTF", start: 2026-10-01T09:00:00-03:00, end: 2026-10-01T18:00:00-03:00, url: "http://box" }',
      "github: { org: evt }",
      "modules:",
      "  secure-development:",
      "    targets: [dvwa, vampi]",
      "admins: [dcotelo]",
    ].join("\n"));
    expect(out).toContain(`"name": "Chapter CTF"`);
    expect(out).toContain(`"dates": "October 1, 2026"`);
    expect(out).toContain(`"ctfStartsAt": "2026-10-01T09:00:00-03:00"`);
    expect(out).toMatch(/"targets":\s*\[\s*"dvwa",\s*"vampi"\s*\]/);
    expect(out).toContain(`"dcotelo"`);
    expect(out).not.toContain("juice-shop");
  });

  it("env vars work without a file", () => {
    const out = generate({
      EVENT_NAME: "Env Event",
      EVENT_START: "2026-11-05T10:00:00-03:00",
      EVENT_END: "2026-11-06T18:00:00-03:00",
      EVENT_TARGETS: "webgoat,vampi",
    });
    expect(out).toContain(`"name": "Env Event"`);
    expect(out).toContain(`"dates": "November 5–6, 2026"`);
    expect(out).toMatch(/"targets":\s*\[\s*"webgoat",\s*"vampi"\s*\]/);
  });

  it("rejects unknown module, unknown target, bad dates, empty targets", () => {
    const bad = (yaml: string) => expect(() => generate({}, yaml)).toThrow();
    bad("modules: { forensics: {} }");
    bad("modules:\n  secure-development:\n    targets: [nope]");
    bad("modules:\n  secure-development:\n    targets: []");
    bad('event: { name: X, start: "not-a-date" }\nmodules:\n  secure-development:\n    targets: [dvwa]');
  });
});
