#!/usr/bin/env node
// Vacuous-pass detector — see docs/scorer.md and issue #47.
//
// Points every target's rubric at a stub that is UP but USELESS (vacuous-stub.mjs)
// and runs the REAL exec runner over it. Any challenge that reports a PASS is
// asserting nothing about the target: it would score a contestant points on an
// app that never did anything.
//
// This deliberately reuses `runExec` rather than re-implementing the runner.
// A detector that ran tests its own way could disagree with the judge, and a
// disagreement here is indistinguishable from a finding.
//
// Usage:
//   node scorer/tools/vacuous-sweep.mjs [--rubric DIR] [--target NAME]...
//                                       [--personality NAME]... [--json PATH]
//                                       [--concurrency N] [--safety-ms N]

import { writeFileSync } from "node:fs";
import { loadRubric } from "../src/rubric.js";
import { getTarget } from "../src/targets.js";
import { runExec } from "../src/exec.js";
import { HEALTH_PATHS_BY_TARGET, PERSONALITY_NAMES, startStub } from "./vacuous-stub.mjs";

function parseArgs(argv) {
  const out = {
    rubric: "rubric.owasp",
    targets: [],
    personalities: [],
    json: null,
    // Matches the judge's own default deliberately. A SHORTER window makes the
    // sweep under-report: the runner scores a timed-out challenge as "not
    // solved", which is indistinguishable from "asserted something real". Two
    // vampi challenges flip from clean to vacuous between 15s and 20s purely
    // on this. Results are deterministic at a given value; lowering it trades
    // runtime for false negatives, so raise it if a target looks suspiciously
    // clean.
    safetyMs: 30_000,
    // Raised from the judge's serial default: several targets pin concurrency
    // to 1 because their tests mutate SHARED SERVER STATE. The stub holds no
    // state, so that hazard does not exist here.
    concurrency: 8,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--rubric") out.rubric = next();
    else if (a === "--target") out.targets.push(next());
    else if (a === "--personality") out.personalities.push(next());
    else if (a === "--json") out.json = next();
    else if (a === "--safety-ms") out.safetyMs = Number(next());
    else if (a === "--concurrency") out.concurrency = Number(next());
    else throw new Error(`unknown argument: ${a}`);
  }
  if (out.personalities.length === 0) out.personalities = [...PERSONALITY_NAMES];
  for (const p of out.personalities) {
    if (!PERSONALITY_NAMES.includes(p)) throw new Error(`unknown personality: ${p}`);
  }
  return out;
}

async function sweepTarget(targetName, challenges, personality, opts) {
  const target = getTarget(targetName);
  if (!target?.urlEnv) return { targetName, personality, error: "no urlEnv in targets.js" };

  // Fail closed. Without the target's real probe path the stub never goes
  // green, every file dies at import, and the sweep reports a confident zero
  // for a target it never measured — worse than reporting nothing at all.
  const healthPaths = HEALTH_PATHS_BY_TARGET[targetName];
  if (!healthPaths) {
    return { targetName, personality, error: "no health path in HEALTH_PATHS_BY_TARGET" };
  }

  const stub = await startStub(personality, { healthPaths });
  try {
    const env = {
      ...process.env,
      [target.urlEnv]: stub.url,
      CTF_SCORE_SAFETY_MS: String(opts.safetyMs),
    };
    const { solved, aborted } = await runExec(challenges, { concurrency: opts.concurrency, env });
    return {
      targetName,
      personality,
      total: challenges.length,
      vacuous: solved,
      requests: stub.requests,
      paths: stub.paths,
      // `aborted` means the runner gave up partway and SKIPPED challenges. Those
      // were never measured, so a clean result on an aborted run proves nothing
      // — reported rather than folded into the pass count.
      aborted,
    };
  } finally {
    await stub.close();
  }
}

async function main() {
  const opts = parseArgs(process.argv);
  const rubric = loadRubric(opts.rubric);
  if (!rubric) {
    console.error(`vacuous-sweep: no rubric at ${opts.rubric}`);
    process.exit(2);
  }
  // loadRubric returns { targets: Map, pointsFor, totalFor } — the Map is one
  // field of it, not the return value itself.
  const { targets: byName } = rubric;

  const names = opts.targets.length > 0 ? opts.targets : [...byName.keys()];
  const results = [];

  for (const name of names) {
    const entry = byName.get(name);
    if (!entry) {
      console.error(`vacuous-sweep: target not in rubric: ${name}`);
      process.exitCode = 2;
      continue;
    }
    for (const personality of opts.personalities) {
      process.stderr.write(`  ${name} / ${personality} … `);
      const r = await sweepTarget(name, entry.challenges, personality, opts);
      results.push(r);
      if (r.error) {
        // A skipped target is dropped from the report below, so it must not
        // also exit clean — an unmeasured target reads as a passing sweep.
        process.exitCode = 2;
        process.stderr.write(`skipped (${r.error})\n`);
      } else {
        process.stderr.write(`${r.vacuous.length}/${r.total} vacuous${r.aborted ? " (ABORTED)" : ""}\n`);
      }
    }
  }

  // Union across personalities: a challenge only has to pass under ONE shape of
  // uselessness to be asserting nothing.
  const byTarget = new Map();
  for (const r of results) {
    if (r.error) continue;
    const acc = byTarget.get(r.targetName) ?? {
      total: r.total,
      ids: new Set(),
      aborted: false,
      paths: new Set(),
    };
    r.vacuous.forEach((id) => acc.ids.add(id));
    acc.aborted ||= r.aborted;
    (r.paths ?? []).forEach((p) => acc.paths.add(p));
    byTarget.set(r.targetName, acc);
  }

  console.log("\n=== vacuous-pass sweep ===\n");
  let grandTotal = 0;
  let grandVacuous = 0;
  for (const [name, acc] of byTarget) {
    grandTotal += acc.total;
    grandVacuous += acc.ids.size;
    // A zero is only meaningful if the rubric actually exercised the stub.
    // Two ways it silently does not: the runner aborts and skips challenges,
    // or the target's helpers get stuck on a gate every file has to clear
    // first (a login, a fixture, docker) and die before touching the endpoint
    // under test. Both look exactly like a clean bill.
    //
    // Distinct paths is the discriminator, not request count. A target stuck
    // at a login and a target whose anti-vacuous preconditions are correctly
    // firing BOTH issue roughly one request per challenge — the count cannot
    // tell them apart, and reading it as a bailout libels the targets that
    // have been hardened. Where those requests GO does tell them apart: one
    // path repeated for every challenge means the rubric never got past the
    // gate, while a path per challenge means it reached the app's surface and
    // was turned away on the merits.
    const distinct = acc.paths.size;
    const stuck = acc.total > 1 && distinct <= 1;
    const warn = acc.aborted
      ? "  ** run aborted — challenges skipped, a clean result here proves nothing **"
      : acc.ids.size === 0 && stuck
        ? `  ** reached ${distinct} distinct path${distinct === 1 ? "" : "s"} across ${acc.total} challenges` +
          " — the rubric never got past a shared gate; NOT a clean bill **"
        : "";
    console.log(`${name}: ${acc.ids.size} of ${acc.total} pass against a useless target${warn}`);
    for (const id of [...acc.ids].sort()) console.log(`    ${id}`);
    if (acc.ids.size === 0) console.log("    (none)");
    console.log("");
  }
  console.log(`TOTAL: ${grandVacuous} of ${grandTotal}`);
  console.log(
    "\nThis is a LOWER BOUND. A challenge is only reported when it PASSES against\n" +
      "a useless target; anything that timed out, aborted, or died in its helpers is\n" +
      "counted as clean. Targets flagged above were not meaningfully measured.",
  );

  if (opts.json) {
    writeFileSync(opts.json, JSON.stringify({ results }, null, 2) + "\n");
    console.log(`\nwrote ${opts.json}`);
  }

  // Non-zero when anything is vacuous, so this can gate CI once the findings
  // are fixed. Until then it is informational — run it, read the list.
  if (grandVacuous > 0) process.exitCode = 1;
}

await main();
