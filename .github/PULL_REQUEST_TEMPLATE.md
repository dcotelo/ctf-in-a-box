<!-- This template is for contributing to the CTF-in-a-box KIT itself
     (platform code, scorer, sync, setup, docs). If you're a contestant
     submitting a patch to a target app during an event, you want
     setup/PULL_REQUEST_TEMPLATE.md in the event fork instead — this one
     is not it. -->

## Summary

<!-- What does this PR change, and why? -->

## Type

- [ ] feat
- [ ] fix
- [ ] docs
- [ ] test
- [ ] chore
- [ ] ci

## Service(s) touched

- [ ] apps/web
- [ ] scorer
- [ ] sync
- [ ] setup
- [ ] docs

## Test evidence

<!-- List the commands you ran locally and their outcome, e.g.: -->
<!-- cd scorer && npm ci && npm test -->
<!-- ./scripts/acceptance-scorer.sh -->

## Checklist

- [ ] CI is green.
- [ ] Commit messages follow Conventional Commits (`feat:`, `fix:`, `docs:`,
      `test:`, `chore:`, `ci:`, ...).
- [ ] No AI attribution in commits or this PR (no "Generated with", no
      `Co-authored-by:` trailers for an AI tool/agent).
- [ ] Docs updated if this changes user-facing behavior or commands.
