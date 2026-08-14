# Per-challenge regression tests

Each test in `challenges/` exercises **one** Juice Shop vulnerability. The test **fails** on unpatched code (the exploit still works) and **passes** once the contestant's patch closes the hole.

CI runs every test on every PR to the [`OWASP-CTF/juice-shop`](https://github.com/OWASP-CTF/juice-shop) fork via the baked score image ([`OWASP-CTF/score-action`](https://github.com/OWASP-CTF/score-action)). A passing test for the challenge a PR claims to fix is the gate for the bonus flag.

## Run locally

Boot the canonical CTF version (Safety Mode off so every vuln is live):

```sh
docker run --rm -p 3000:3000 \
  -e NODE_CONFIG='{"challenges":{"safetyMode":"disabled"}}' \
  bkimminich/juice-shop:v20.0.0
```

The three static source-analysis challenges (09/12/16) read TypeScript instead of probing HTTP — point them at a source tree (your patched fork checkout, or a stock clone at the same version) via `CTF_UPSTREAM_DIR`:

```sh
export CTF_UPSTREAM_DIR=/path/to/juice-shop-fork
```

In a second terminal, run all challenge tests (from the **repo root**):

```sh
node --test --test-reporter=spec juice-shop/tests/challenges/
```

Or use the score CLI to get a formatted table with difficulty-weighted points (from the repo root):

```sh
npm --prefix .github/actions/ctf-score run score -- \
  --dir "$(pwd)/juice-shop/tests/challenges"             # score table
npm --prefix .github/actions/ctf-score run score -- \
  --dir "$(pwd)/juice-shop/tests/challenges" --verbose   # + full output for every failing test
```

Point at a different host with `JUICE_SHOP_URL` or the `--url` flag:

```sh
JUICE_SHOP_URL=http://localhost:3000 node --test juice-shop/tests/challenges/
npm --prefix .github/actions/ctf-score run score -- \
  --dir "$(pwd)/juice-shop/tests/challenges" --url http://localhost:3000
```

## Adding a new challenge test

1. Create `challenges/NN-<short-slug>.test.js`.
2. Use [`node:test`](https://nodejs.org/api/test.html) (stdlib — no runner dependency).
3. Use [`helpers.js`](helpers.js) for `api()`, `registerAndLogin()`, `waitForServer()`.
4. The test should **fail** when the vulnerability is present and **pass** when patched.
5. Failure messages should point the contestant at the file(s) most likely to need editing.

## Why `node --test`?

Zero dependencies. Node 20+ ships it. Compatible with `fetch` in stdlib. No `vitest`/`jest`/`mocha` install overhead in CI.
