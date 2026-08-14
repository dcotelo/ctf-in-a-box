// Records this child's execution WINDOW (pid, start, end) to the shared file
// named by EXEC_WINDOW_MARKER, so a caller can prove — by overlap, not by
// wall-clock comparison — whether children ran serially or in parallel.
//
// Timing the two runs and asserting `serialMs > parallelMs` cannot do that:
// process-spawn jitter is the same order as the signal being measured, so the
// comparison flaps. Overlap is a property of the schedule itself and holds no
// matter how slow or loaded the machine is.
//
// The window is captured INSIDE the test body and written before the body
// returns, because the runner kills the child the moment its reporter line
// appears — anything logged after that may never be flushed.
import { test } from "node:test";
import { appendFileSync } from "node:fs";

const HOLD_MS = 600;

test("window", async () => {
  const start = Date.now();
  await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
  const end = Date.now();
  if (process.env.EXEC_WINDOW_MARKER) {
    // One line per child; O_APPEND makes a write this small atomic across
    // processes, so concurrent children cannot interleave mid-line.
    appendFileSync(process.env.EXEC_WINDOW_MARKER, `${process.pid} ${start} ${end}\n`);
  }
});
