---
title: CTF-in-a-box
---

# CTF-in-a-box

Self-hosted OWASP CTF: run the OWASP Secure Development CTF — the
patch-the-vulnerability format (fork target app → find + patch the vuln →
PR back → GitHub Actions scores the patch) on your own hardware. One box,
one free GitHub org, no cloud dependencies.

Contestants sign in, pick from up to six vulnerable target apps
(`juice-shop`, `dvwa`, `webgoat`, `securityshepherd`, `vulnerableapp`,
`vampi`), fork the org's copy, patch it, and open a PR. A GitHub Action
scores the PR and the score lands on your box's leaderboard.

## What contestants see

![Demo: leaderboard and challenge browser](assets/demo.gif)

| Leaderboard | Challenge browser |
|---|---|
| ![Leaderboard](assets/leaderboard.jpg) | ![Challenges](assets/challenges.jpg) |

## Quickstart

```sh
./setup/ctf-setup.sh check
./setup/ctf-setup.sh secrets
cp event.yaml.example event.yaml   # edit: org, targets, admins, url
./setup/ctf-setup.sh org           # fork targets, fetch workflow, mirror image
docker compose --profile poll --profile app up -d
```

Full prerequisites, OAuth setup, and operational details live in the
[README on GitHub](https://github.com/dcotelo/ctf-in-a-box#quickstart).

## Learn more

- [Module contract](modules.md) — what a CTF vertical (target list,
  challenge catalogue, scoring transport) must satisfy to plug in.
- [Architecture](architecture.md) — what runs where, how a score gets
  from a contestant's PR to the leaderboard.
- [Decisions](decisions.md) — numbered ADRs for why the kit is built the
  way it is.

## Status

This kit is complete and tested against fixtures — the offline smoke test
(`scripts/smoke.sh`) exercises the whole poll pipeline end to end. Real,
live-GitHub scoring depends on two changes landing in other OWASP-CTF
repos, plus one item still open in this repo. See the
[Status / upstream dependencies](https://github.com/dcotelo/ctf-in-a-box#status--upstream-dependencies)
section of the README for the current state.

---

[Source on GitHub](https://github.com/dcotelo/ctf-in-a-box) ·
[OWASP-CTF/dc34-owasp-secure-development-ctf](https://github.com/OWASP-CTF/dc34-owasp-secure-development-ctf)
(underlying spec and target apps)
