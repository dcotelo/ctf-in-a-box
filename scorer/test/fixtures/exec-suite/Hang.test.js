// Blocks before any test registers — the signature of a child pointed at an
// unreachable app. Used to prove the unreachable early-abort fires.
await new Promise(() => {});
