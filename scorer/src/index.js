import { serve } from "./serve.js";

const USAGE = "usage: score <serve|judge>";

async function main() {
  const cmd = process.argv[2];
  if (cmd === "serve") {
    await serve();
    return;
  }
  if (cmd === "judge") {
    console.error("judge: implemented in a later task");
    process.exit(2);
  }
  console.error(USAGE);
  process.exit(2);
}

main().catch((err) => {
  console.error(`ctf-score-engine fatal: ${err.message}`);
  process.exit(1);
});
