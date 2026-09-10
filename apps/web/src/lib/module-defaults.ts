// Pure — no server-only import, no I/O — so the admin panel's tests and the
// server can share it. The ONLY input is SCORE_IMAGE: a deployment that has a
// scorer image runs Secure Development; one that does not cannot (the scorer
// and sync containers are never started, see docker-compose.yml). Every other
// module starts OFF and is switched on from /admin (issue #386).
//
// Callers MUST pass the server's env or rely on the default in server-only
// code. A client bundle has no SCORE_IMAGE and would compute the wrong answer.
import type { ModuleId } from "@/lib/modules";

export function secureDevAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return typeof env.SCORE_IMAGE === "string" && env.SCORE_IMAGE.trim() !== "";
}

/** The module set when nothing is stored in ctf:admin:settings, and the
 *  fail-open answer when that read fails. */
export function defaultEnabledModules(env: NodeJS.ProcessEnv = process.env): readonly ModuleId[] {
  return secureDevAvailable(env) ? ["secure-development"] : [];
}
