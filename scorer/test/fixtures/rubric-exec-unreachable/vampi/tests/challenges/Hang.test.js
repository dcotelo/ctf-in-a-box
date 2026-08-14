// A child that never reports — the signature of a target that stopped
// answering. Blocks on a live timer, because a bare unsettled top-level await
// does NOT hold the Node event loop open (Node exits after ~100ms and prints a
// duration_ms summary, which would make this fixture report instead of hang).
// Only the runner's safety-kill ends it.
await new Promise((resolve) => setTimeout(resolve, 600_000));
