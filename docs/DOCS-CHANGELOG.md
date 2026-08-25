# Documentation overhaul — changelog (Phase 3 report)

Executed 2026-08-25 on branch `docs/overhaul`, 24 commits, per the audit in
[DOCS-PLAN.md](DOCS-PLAN.md). Everything below states what changed and why,
the drift found and how each item was resolved, what was deliberately left
alone, and what could not be verified and therefore was not written.

## What changed

**README.md** — rewritten. Status above the fold (complete and tested
offline; the full scoring path ships in-kit; **not yet validated against a
real live event** — the wording the owner chose), a fair CTFd/picoCTF
comparison with explicit non-goals, an OWASP non-affiliation note, a
quickstart that leads with the no-GitHub path (`scripts/dev-stack up`,
verified against the script), one compact block per module instead of four
feature tables, a ~15-line "How it works" with a Mermaid diagram keeping the
poll-vs-push annotation, a corrected License section, links to
CONTRIBUTING/SECURITY/CoC (previously none), badges 7 → 3.

**Code, not prose — five fixes the audit surfaced, all applied:**

1. `deploy/aws-terraform/` — the bring-up script never fetched
   `REDIS_PASSWORD`, which compose requires with `:?`; **the documented AWS
   deploy failed at interpolation**. Fixed fail-closed + README SSM list +
   a tftest assertion. (`fix(aws)`)
2. `docker-compose.yml` — `ALLOW_INSECURE_EVENT_URL` and
   `CHALLENGES_GATE_ENABLED`/`_PASSWORD` were documented knobs the app
   service never received; setting them did nothing. Plumbed through, gate
   pair added to `.env.example`. (`fix(compose)`)
3. Branding (`fix(app)`): default event name "OWASP CTF" → "CTF-in-a-box",
   the hardcoded OWASP-logo hero removed, the false "each app is an OWASP
   project" line corrected (DVWA and VAmPI are community projects), the
   five baked "the OWASP CTF area" strings now render `{event.name}`. Full
   app suite green (2266 tests); `acceptance-app.sh`'s default-name
   assertion updated.
4. `leaderboard/page.tsx` — the stale pipeline-order comment (argued
   penalties-first; the code folds them last) rewritten with the real
   rationale. The one authorized source-comment fix.
5. `.github/dependabot.yml` — `terraform` ecosystem added for
   `deploy/aws-terraform`, the only ecosystem left out.

**Drift fixes, doc by doc** (each its own commit; code cited in the commit):

- `operations.md` — Status section rewritten (see "the status inversion"
  below); classic paid hints documented as shipped (#210), not "planned";
  hint gate stated as per-target; bundle docs name the optional
  `caseSensitive`/`hint` fields; reset type-to-confirm documents the
  literal `RESET`; the gate section says where its env vars are set and no
  longer claims the proxy matcher skips `/api/*`.
- `architecture.md` — module enablement is runtime (ADR 52) in all three
  places that said build-time, `enabledModules` added to the settings
  table; "private image" framing aligned with ADR 18 in the diagram,
  components table and security model; CI "seven jobs" → the real gate +
  nine (adding `vacuous` and `docs`); testing table gains classic-only and
  vacuous-sweep rows; `firstAt` added to the classic attempts row;
  `ctf:activity:log` added to the reset enumeration; `outsideWindow`
  pointer moved to `schedule-window.ts`; two "see README" pointers now name
  the docs that own the content.
- `hosting.md` — the retired `teams:`/`hints:` event.yaml keys removed from
  both passages (ADR 31 amendment; an organizer was being told to configure
  team play in a file that ignores it); classic added to the profiles
  table; the full subcommand/flag list documented; workflow-version samples
  refreshed to the template's v3 and marked as samples.
- `modules.md` — the hint-fold order un-inverted (penalties fold last);
  the dead README "Status" pointer re-aimed at operations.md; retired keys
  dropped from the intro; admin components' real paths; oracle-discipline
  and token-isolation arguments restated to stand without the private-image
  premise; a module-author orientation paragraph added.
- `decisions.md` — every ADR now carries a **Status** line; ADR 17 marked
  Superseded by 18 (it had no forward pointer); ADR 8's inverted premise,
  ADR 14's default-name amendment and ADR 19's resolved limitation stated;
  the `[#43](#43-…)` placeholder replaced with the workflow-upgrade link it
  meant; ADRs 3/6 no longer call the bearer-auth/score-action dependencies
  unlanded; stale pointers (TEAM_MAX_MEMBERS → `team-limits.ts`,
  `outsideWindow` → `schedule-window.ts`) fixed; a 52-entry index added;
  the three unnumbered rider headings foldered under their ADRs.
- `security-checklist.md` — plaintext classic-flags *and quiz answer keys*
  visible-to-admins stated (verified in code); check 4 reframed for the
  public stock rubric; a printable operational (week-before / morning-of)
  half added.
- `SECURITY.md` — the false "no versioned release" claim fixed against tags
  v0.1.0–v0.3.0; a known-properties section (plaintext keys; the scorer
  executes submissions) states the deliberate boundaries and what about
  them IS in scope.
- `CONTRIBUTING.md` — the release-forbidden claim (contradicted by three
  existing tags) removed; dev environment, per-layer commands inline, the
  ten CI jobs, the testing conventions held on purpose, a module-proposal
  path, and the real release convention.
- `AGENTS.md` — the "matches CI exactly" shell block now actually does
  (fly scripts + `deploy/fly/test/`); the scorer block's working-directory
  mix fixed; the lockstep pointer names `schedule-window.ts`.
- `index.md` — Status teaser updated; "neutral OWASP CTF default" phrasing
  dropped; nav rows for the two new pages.
- `fly.md` — docs-home backlink added; dead `nav_order` key dropped; TOC's
  phantom entry removed and two missing sections added.

**New files:** `docs/troubleshooting.md` (the symptom-first mid-event
runbook), `docs/glossary.md` (terms + the five-spellings table, moved from
architecture.md which keeps a pointer), `docs/README.md` (per-audience
GitHub-directory index, Jekyll-excluded), `CHANGELOG.md` (backfilled from
the three annotated tags).

**Anchor migration.** Numbered headings slug differently on GitHub (keeps
digits) and kramdown (strips them), so ~45 deep links into ADRs and
modules.md sections landed at page-top on the published site. All ADRs are
now `## ADR N. …` and modules.md sections `## Section N. …` — letter-first
titles slug identically on both renderers — with every internal link
rewritten in the same commits. Three ADR titles carried
`pull_request_target`/`EVENT_URL` verbatim (kramdown drops underscores;
GitHub keeps them) and were reworded, terms kept in the bodies. A full-set
link checker over both slug algorithms reports **zero dead anchors**.

## The status inversion (the drift that mattered most)

The docs — and the project's own working assumptions — said live-GitHub
scoring depends on two unlanded upstream changes (scorer bearer auth;
`score-action` inputs + machine comment). Both ship **in-kit**:
`scorer/src/serve.js:34-52,345` and
`scorer/consumer-workflow.example.yml:97,307-369`. Five doc locations and
two ADRs carried the stale claim; all rewritten. The third status item aged
too: the Security Shepherd under-crediting bug (32-hex echo read as a
result key) was **fixed in the vendored copy** (#101 — fallback raised to
64–128 hex, contextual matchers); what remains is the matcher's own stated
residual (an "isn't correct"-phrased refusal reads as a solve; bias stays
under-credit-only). Status now says: complete and tested offline, path
ships in-kit, awaiting a first real live event.

## Deliberately left alone

- `architecture.md` kept whole (not split per-module) — it is the de-facto
  Redis-key and freeze-semantics reference with 17 inbound deep links;
  splitting trades one long good doc for a link-maintenance problem.
- `decisions.md` kept single-file (owner's call, Q4) — the anchor fix +
  index solve navigation; 52 files would break greping and the ADR
  cross-reference web.
- README ↔ index.md still overlap in role — README trimmed its tables, and
  index keeps the fuller feature list because site visitors never see the
  README. The remaining overlap is the two front doors' job.
- ADR bodies were never rewritten — Status lines and inline "since
  resolved" notes only. The record stays a record.
- Every "why"-paragraph and named-bug story in the docs was preserved;
  where a passage was corrected, the history it told was kept as history
  (e.g. ADR 3/6 now say the dependency "landed in-kit instead" rather than
  pretending it never existed).
- `setup/ctf-setup.sh`'s header comment still says "a self-hosted OWASP CTF
  event" — descriptive of the event format's origin; left.
- `event.yaml.example`'s vestigial `oauth_client_id` (no reader) — left in
  place, noted here: removing a config key is a behavior decision, not a
  docs fix.

## Could not verify — therefore not written

- **Live-event validation.** No claim anywhere that the GitHub scoring path
  has run a real event; the owner confirmed "unproven live".
- **The srh subset end-to-end** (pipelining, `EVAL`) — the caveat is kept,
  not resolved: REVIEW.md's finding that the grading Lua scripts are never
  executed by any test still stands.
- **`SameSite=Lax`** — verified against better-auth's shipped cookie
  defaults in `node_modules` (sameSite: "lax"), so the claim stayed.
- **fly.md's operational anecdotes** ("all fourteen secrets Deployed",
  flyctl 0.4.87 behavior) — third-party/historical, left as stated.
- **Rubric licence** (Q2): the owner will add a licence to the upstream
  repo; recording it in PROVENANCE.md + a NOTICE file is **pending that
  upstream change** and was not faked in the meantime. Two related facts
  for that follow-up: the upstream is currently private with
  `license: null`, and the vendored tree is **not byte-identical to the
  pinned commit** — in-repo fixes #101 and #108 modified it, which
  PROVENANCE.md ("do not edit these trees by hand") does not yet record.

## Bugs surfaced for the owner (beyond the five fixed)

- **PROVENANCE.md is stale by omission** — see above; it should record the
  local modifications (or the trees should be re-vendored once upstream
  takes the fixes).
- **`event.yaml.example`'s `oauth_client_id`** has no reader — vestigial.
- Filed during this work: **#217** — make team creation/join the first
  completed step after first sign-in (the module-page redirect exists; the
  Secure Development ingest path has no enforcement point at all).
