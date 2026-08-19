import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
    expect(out).toContain(`"githubOrg": "OWASP-CTF"`);
    expect(out).toContain(`"discordUrl": ""`);
    for (const t of ["juice-shop", "dvwa", "webgoat", "securityshepherd", "vulnerableapp", "vampi"])
      expect(out).toContain(`"${t}"`);
  });

  it("reads the kit event.yaml schema", () => {
    const out = generate({}, [
      'event: { name: "Chapter CTF", start: 2026-10-01T09:00:00-03:00, end: 2026-10-01T18:00:00-03:00, url: "http://box", discord: "https://discord.gg/chapter" }',
      "github: { org: evt }",
      "modules:",
      "  secure-development:",
      "    targets: [dvwa, vampi]",
      "admins: [dcotelo]",
    ].join("\n"));
    expect(out).toContain(`"name": "Chapter CTF"`);
    expect(out).toContain(`"dates": "October 1, 2026"`);
    expect(out).toContain(`"ctfStartsAt": "2026-10-01T09:00:00-03:00"`);
    expect(out).toContain(`"githubOrg": "evt"`);
    expect(out).toContain(`"discordUrl": "https://discord.gg/chapter"`);
    expect(out).toMatch(/"targets":\s*\[\s*"dvwa",\s*"vampi"\s*\]/);
    expect(out).toContain(`"dcotelo"`);
    expect(out).not.toContain("juice-shop");
  });

  it("yaml without github.org falls back to the OWASP-CTF default", () => {
    const out = generate({}, [
      'event: { name: "No Org CTF", url: "http://box" }',
      "modules:",
      "  secure-development:",
      "    targets: [dvwa]",
    ].join("\n"));
    expect(out).toContain(`"githubOrg": "OWASP-CTF"`);
  });

  it("env vars work without a file", () => {
    const out = generate({
      EVENT_NAME: "Env Event",
      EVENT_START: "2026-11-05T10:00:00-03:00",
      EVENT_END: "2026-11-06T18:00:00-03:00",
      EVENT_TARGETS: "webgoat,vampi",
      EVENT_GITHUB_ORG: "env-org",
      EVENT_DISCORD: "https://discord.gg/envevent",
    });
    expect(out).toContain(`"name": "Env Event"`);
    expect(out).toContain(`"dates": "November 5–6, 2026"`);
    expect(out).toContain(`"githubOrg": "env-org"`);
    expect(out).toContain(`"discordUrl": "https://discord.gg/envevent"`);
    expect(out).toMatch(/"targets":\s*\[\s*"webgoat",\s*"vampi"\s*\]/);
  });

  it("env vars without EVENT_GITHUB_ORG/EVENT_DISCORD fall back to defaults", () => {
    const out = generate({
      EVENT_NAME: "Env Event",
      EVENT_START: "2026-11-05T10:00:00-03:00",
    });
    expect(out).toContain(`"githubOrg": "OWASP-CTF"`);
    expect(out).toContain(`"discordUrl": ""`);
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

  it("accepts two modules and derives targets from secure-development", () => {
    const out = generate({}, [
      'event: { name: "Two Module Event" }',
      "github: { org: acme }",
      "modules:",
      "  secure-development: { targets: [dvwa], score_ingest: poll }",
      "  quiz: { enabled: true }",
      "admins: [alice]",
    ].join("\n"));
    expect(out).toMatch(
      /"modules":\s*\[\s*\{\s*"id":\s*"secure-development",\s*"targets":\s*\[\s*"dvwa"\s*\],\s*"scoreIngest":\s*"poll"\s*\},\s*\{\s*"id":\s*"quiz"\s*\}\s*\]/
    );
    expect(out).toMatch(/"targets":\s*\[\s*"dvwa"\s*\]/);
  });

  it("still rejects an unregistered module id", () => {
    expect(() =>
      generate({}, [
        'event: { name: "X" }',
        "modules: { forensics: { enabled: true } }",
      ].join("\n"))
    ).toThrow();
  });

  it("allows a quiz-only event, leaving targets empty", () => {
    const out = generate({}, [
      'event: { name: "Quiz Only" }',
      "modules: { quiz: { enabled: true } }",
    ].join("\n"));
    expect(out).toMatch(/"modules":\s*\[\s*\{\s*"id":\s*"quiz"\s*\}\s*\]/);
    expect(out).toMatch(/"targets":\s*\[\]/);
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

// event.yaml's `modules:` block is read by THREE independent parsers in
// three languages with no shared code (sync/src/config.js, setup/ctf-setup.sh,
// this file's own scripts/generate-event-config.mjs). setup/test/corpus/ is
// the shared corpus that pins down what all three must ACCEPT and REJECT:
// setup/test/module_readers.bats runs it through the bash reader and
// sync/test/module-readers.differential.test.js runs it through sync's — but
// nothing ran it through this one, so a module registered in sync/bash and
// forgotten here (as `classic` briefly was) passed 1645 app tests and 60 sync
// tests with nobody noticing. This suite is the third leg: it consumes the
// SAME corpus so any future module's fixture is automatically covered by all
// three readers, not two.
describe("generate-event-config corpus differential", () => {
  const CORPUS = resolve(__dirname, "..", "..", "..", "..", "setup", "test", "corpus");

  // docs/decisions.md ADR 24: a present-but-empty `modules: {}` is a valid,
  // nothing-enabled config to sync and the bash reader, but this reader is
  // deliberately one notch stricter and fails it at build time ("at least one
  // module is required") — a known, documented, and safe-direction asymmetry
  // (it fails loudly rather than silently provisioning less), not a bug. It
  // is excluded from the blanket agreement assertion below and asserted on
  // its own instead, so the exception stays visible rather than silently
  // dropped.
  const KNOWN_DIVERGENCE = "accept-flow-empty-mapping.yaml";

  const fixtures = readdirSync(CORPUS)
    .filter((f) => f.endsWith(".yaml"))
    .sort();

  // The `# targets: a,b` header a fixture records (empty when there are none).
  function recordedTargets(file: string): string[] {
    const line = readFileSync(join(CORPUS, file), "utf8")
      .split("\n")
      .map((l) => l.replace(/\r$/, ""))
      .find((l) => l.startsWith("# targets:"));
    if (!line) return [];
    return line.slice("# targets:".length).split(",").map((t) => t.trim()).filter(Boolean);
  }

  function verdict(file: string): { verdict: "accept" | "reject"; targets: string[]; error?: string } {
    try {
      const out = generate({}, readFileSync(join(CORPUS, file), "utf8"));
      const m = out.match(/"targets":\s*(\[[^\]]*\])/);
      return { verdict: "accept", targets: m ? JSON.parse(m[1]) : [] };
    } catch (err) {
      return { verdict: "reject", targets: [], error: (err as Error).message };
    }
  }

  it("corpus is big enough and covers both verdicts", () => {
    const accept = fixtures.filter((f) => f.startsWith("accept-"));
    const reject = fixtures.filter((f) => f.startsWith("reject-"));
    expect(accept.length + reject.length).toBe(fixtures.length);
    expect(fixtures.length).toBeGreaterThanOrEqual(30);
    expect(accept.length).toBeGreaterThanOrEqual(12);
    expect(reject.length).toBeGreaterThanOrEqual(12);
  });

  it("agrees with every fixture's recorded verdict, except the one documented divergence (ADR 24)", () => {
    const mismatches: string[] = [];
    for (const f of fixtures) {
      if (f === KNOWN_DIVERGENCE) continue;
      const want = f.startsWith("accept-") ? "accept" : "reject";
      const got = verdict(f);
      if (got.verdict !== want) {
        mismatches.push(`${f}: want ${want}, got ${got.verdict}${got.error ? ` (${got.error})` : ""}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("extracts each accepted fixture's recorded targets", () => {
    const mismatches: string[] = [];
    for (const f of fixtures.filter((x) => x.startsWith("accept-") && x !== KNOWN_DIVERGENCE)) {
      const want = recordedTargets(f);
      const got = verdict(f);
      if (JSON.stringify(got.targets) !== JSON.stringify(want)) {
        mismatches.push(`${f}: want [${want}], got [${got.targets}]`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("the one documented divergence stays a divergence: this reader rejects an empty modules: {} (ADR 24)", () => {
    expect(verdict(KNOWN_DIVERGENCE).verdict).toBe("reject");
  });
});
