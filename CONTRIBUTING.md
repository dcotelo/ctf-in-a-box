# Contributing to CTF-in-a-box

Thanks for your interest in contributing. This document covers how the repo
is laid out, how to build and test each piece, and the process for getting a
change merged.

## Repo layout

- **`apps/web/`** — the vendored Next.js contestant app (auth, teams,
  leaderboard, admin panel). Managed with `pnpm`.
- **`scorer/`** — the judge + leaderboard scoring engine. Plain Node.js,
  tested with `node:test`.
- **`sync/`** — the poll service that watches for score comments and feeds
  the leaderboard. Plain Node.js, tested with `node:test`.
- **`setup/`** — `ctf-setup.sh` and the event provisioning flow. Bash,
  tested with `bats`.
- **`docs/`** — the documentation site, published via GitHub Pages.

## Building and testing

The authoritative list of build/test/lint commands — matched exactly to what
CI runs — lives in [`AGENTS.md`](AGENTS.md#buildtestlint). Read that before
opening a PR; the short version is: each service has its own test command
(`npm test`, `pnpm test`, `bats`, `shellcheck`), and `./scripts/smoke.sh`
exercises the stack end to end.

## Pull request flow

1. Branch off `main`.
2. Make your change. Keep commits scoped and use
   [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`,
   `fix:`, `docs:`, `test:`, `chore:`, `ci:`, ...).
3. Run the relevant tests locally (see `AGENTS.md`).
4. Open a pull request against `main`. Fill in the PR template.
5. CI must be green before merge. The CI workflow only runs jobs for the
   areas your PR touches (see `AGENTS.md` for how that gating works) — a
   push to `main` always runs everything as a safety net.

## Release process

**No release has been cut yet, and none should be tagged or published until
the full end-to-end flow — fork, patch, score, leaderboard — has been
validated (tracked separately as project work). Do not tag or publish a
release before that validation is done.**

Once releases begin, the intended process is:

- Versions follow [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`).
- Conventional Commits on `main` provide the changelog input: `feat:` implies
  a minor bump, `fix:`/`docs:`/`chore:`/etc. imply a patch bump, and a
  `BREAKING CHANGE:` footer (or `!` after the type) implies a major bump.
- Releases are cut as GitHub Releases, tagged from `main`, with release
  notes generated from the commit history since the previous tag.

## AI-assisted contributions

AI- and agent-assisted pull requests are welcome. A few rules apply:

- The **human author is responsible** for the change. You are expected to
  understand, review, and stand behind everything in your PR, whether you
  typed it or an agent did.
- Commits and PRs carry **no AI attribution** — no "Generated with", no
  `Co-authored-by:` trailers for an AI tool or agent. Write commit messages
  as you would for any other change.
- If you're using an agent to help write code in this repo, have it follow
  [`AGENTS.md`](AGENTS.md) — it documents the exact build/test commands and
  the project's real conventions and gotchas (bash compatibility, shellcheck
  rules, bats assertion pitfalls, the stock-scores-zero invariant, and so
  on).
