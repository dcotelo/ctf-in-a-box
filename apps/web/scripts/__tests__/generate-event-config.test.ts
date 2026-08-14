import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(__dirname, "..", "generate-event-config.mjs");

function generate(env: Record<string, string>, yaml?: string) {
  const dir = mkdtempSync(join(tmpdir(), "evcfg-"));
  const out = join(dir, "generated.ts");
  const fullEnv: NodeJS.ProcessEnv = { ...process.env, OUT_PATH: out };
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

  it("display dates are independent of build-machine timezone (TZ=UTC)", () => {
    const yaml = [
      'event: { name: "UTC Test", start: 2026-01-01T01:00:00+09:00, url: "http://test" }',
      "modules:",
      "  secure-development:",
      "    targets: [dvwa]",
    ].join("\n");
    const dir = mkdtempSync(join(tmpdir(), "evcfg-"));
    const cfg = join(dir, "event.yaml");
    writeFileSync(cfg, yaml);
    const out = join(dir, "generated.ts");
    const fullEnv: NodeJS.ProcessEnv = { ...process.env, OUT_PATH: out, EVENT_CONFIG: cfg, TZ: "UTC" };
    // Don't delete EVENT_CONFIG - only delete EVENT_* env var overrides
    for (const k of Object.keys(fullEnv)) if (k.startsWith("EVENT_") && k !== "EVENT_CONFIG") delete fullEnv[k];
    execFileSync("node", [SCRIPT], { env: fullEnv });
    const result = readFileSync(out, "utf8");
    expect(result).toContain(`"dates": "January 1, 2026"`);
  });

  it("display dates are independent of build-machine timezone (TZ=Pacific/Auckland)", () => {
    const yaml = [
      'event: { name: "Auckland Test", start: 2026-10-01T09:00:00-03:00, end: 2026-10-02T18:00:00-03:00, url: "http://test" }',
      "modules:",
      "  secure-development:",
      "    targets: [dvwa]",
    ].join("\n");
    const dir = mkdtempSync(join(tmpdir(), "evcfg-"));
    const cfg = join(dir, "event.yaml");
    writeFileSync(cfg, yaml);
    const out = join(dir, "generated.ts");
    const fullEnv: NodeJS.ProcessEnv = { ...process.env, OUT_PATH: out, EVENT_CONFIG: cfg, TZ: "Pacific/Auckland" };
    // Don't delete EVENT_CONFIG - only delete EVENT_* env var overrides
    for (const k of Object.keys(fullEnv)) if (k.startsWith("EVENT_") && k !== "EVENT_CONFIG") delete fullEnv[k];
    execFileSync("node", [SCRIPT], { env: fullEnv });
    const result = readFileSync(out, "utf8");
    expect(result).toContain(`"dates": "October 1–2, 2026"`);
  });

  it("display dates handle cross-month ranges correctly", () => {
    const out = generate(
      {},
      [
        'event: { name: "Cross-month", start: 2026-10-30T09:00:00-03:00, end: 2026-11-02T18:00:00-03:00, url: "http://test" }',
        "modules:",
        "  secure-development:",
        "    targets: [dvwa]",
      ].join("\n")
    );
    expect(out).toContain(`"dates": "October 30 – November 2, 2026"`);
  });
});
