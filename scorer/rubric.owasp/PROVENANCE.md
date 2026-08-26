# Rubric provenance

Vendored from the read-only upstream by `scripts/vendor-rubric.sh`.
Do not edit these trees by hand — re-run the script against a newer ref.

- Upstream: `OWASP-CTF/dc34-owasp-secure-development-ctf`
- Upstream commit: `c1ef55835e847c8e05ef1b5d59ae616e38658cf4`
- Vendored on: 2026-08-14

## Local modifications (NOT in the upstream commit above)

The vendored trees carry two in-repo fix families the upstream does not have
yet. **A fresh `vendor-rubric.sh` run copies only the upstream tree and would
wipe them** — CI catches that loudly (`vacuous-sweep` must report 0, and
`patched-scores-right` must score the reference patches), but re-vendor only
once these have landed upstream, or re-apply them after the copy:

- **#101** — `securityshepherd/tests/helpers.js`: `extractSolutionKey`'s bare
  fallback raised from 32 to 64–128 hex and real keys matched with context,
  so an echoed 32-hex user id no longer reads as a result key (a correct
  patch scored ❌ on 29 of 40 challenges); `hasSolvedMessage` gained the
  negation/word-boundary guards.
- **#108** — the anti-vacuous preconditions across four targets' suites
  (assert the app answered usefully before asserting the exploit failed),
  which took the vacuous-pass count to 0.

## Targets

- `juice-shop` — 38 challenges
- `dvwa` — 55 challenges
- `webgoat` — 69 challenges
- `securityshepherd` — 40 challenges
- `vulnerableapp` — 110 challenges
- `vampi` — 9 challenges
