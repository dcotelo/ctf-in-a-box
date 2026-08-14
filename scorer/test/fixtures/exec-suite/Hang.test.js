// Blocks before any test registers — the signature of a child pointed at an
// unreachable app. Used to prove the unreachable early-abort fires.
//
// A bare `await new Promise(() => {})` does NOT hold the Node event loop
// open: Node detects the unsettled top-level await and exits on its own after
// ~100ms, printing a duration_ms summary — which would make this fixture
// report instead of hang. A live timer is what actually blocks the process,
// so only the runner's own safety-kill can end it.
import { appendFileSync } from "node:fs";

// Optional: lets the caller count how many of these children were actually
// spawned (as opposed to short-circuited by the abort gate before ever
// spawning), proving the early-abort's effect directly instead of by clock.
if (process.env.HANG_SPAWN_MARKER) {
  appendFileSync(process.env.HANG_SPAWN_MARKER, "x");
}

await new Promise((resolve) => setTimeout(resolve, 600_000));
