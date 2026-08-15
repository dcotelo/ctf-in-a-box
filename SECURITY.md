# Security Policy

## Supported versions

No versioned release has been cut yet. The `main` branch is the only
supported line — please report issues against the latest commit on `main`.

## Reporting a vulnerability

Please use **GitHub's private vulnerability reporting** for this repository
rather than opening a public issue:

1. Go to the repository's **Security** tab.
2. Click **Report a vulnerability**.
3. Describe the issue, the affected component, and steps to reproduce.

This opens a private advisory visible only to maintainers, so the report
stays confidential while a fix is worked out.

Do not report vulnerabilities through public GitHub issues, discussions, or
pull requests.

## What to report here

**CTF-in-a-box is a deliberately-vulnerable-by-design *training* kit.** The
target applications it hosts (Juice Shop, DVWA, WebGoat, Security Shepherd,
VulnerableApp, VAmPI, and any future module targets) are **intentionally
vulnerable** — finding and patching their flaws is the point of the exercise.
Please do **not** report vulnerabilities in the target apps themselves here;
those belong with the respective upstream projects.

What we do want reports on is the **kit's own infrastructure** — the code
that operates the event, not the practice targets it hosts:

- `scorer/` — the judge and leaderboard scoring engine
- `sync/` — the poll/push scoring transport
- `apps/web/` — the contestant web app (auth, teams, admin panel)
- `setup/` — `ctf-setup.sh` and event provisioning
- `scripts/`, `.github/workflows/` — CI, smoke tests, and automation

Examples of what's in scope: authentication or authorization bypass in the
web app, a way to forge or replay a score submission, a way to escalate
outside your own team's data, secrets handling issues, or a supply-chain
concern in the kit's own build/CI pipeline.

## Response expectations

We aim to:

- Acknowledge a new report within **5 business days**.
- Provide an initial assessment (confirmed, needs more info, or out of scope)
  within **10 business days**.
- Keep the reporter updated as a fix is developed, and credit them in the
  advisory unless they ask to remain anonymous.

This is a community-maintained project run on a best-effort basis; response
times may vary.

## On transfer to the OWASP GitHub org

This project is headed toward the OWASP GitHub org once its MVP is
validated. On transfer, this policy re-aligns to OWASP's own vulnerability
disclosure process and reporting channels; until then, GitHub private
vulnerability reporting on this repository is the channel to use.
