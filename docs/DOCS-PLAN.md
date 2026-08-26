# Documentation overhaul — audit and plan (Phase 0)

Audit date: 2026-08-25, against `main` @ `2b83fc9`. Everything below was verified
by reading the code/config named; nothing is restated from the docs on trust.
Sources cross-checked: the five parallel audits run for this plan, plus the
existing `REVIEW.md` Phase-5 drift section (independent audit, agrees on every
overlapping finding).

**Stop point:** this is the plan. Nothing has been changed yet. Section F lists
the decisions I need from you before Phase 1.

---

## A. Inventory

The Jekyll site publishes `docs/` with the Cayman theme, which has **no
navigation** — `index.md`'s "Learn more" list and hand-written `[← Docs home]`
backlinks are the site's entire nav (fly.md is missing its backlink and carries
a dead `nav_order:` key from a theme it doesn't use). No `permalink:` is set;
GitHub Pages' `jekyll-relative-links` rewrites relative `.md` links to `.html`,
so file-level links work on both renderers. Anchor-level links largely do not
(see B.4).

| Doc | Lines | Intended reader | Uniquely covers |
|---|---:|---|---|
| `README.md` | 263 | Evaluator (then organizer) | Badges; per-target table with maintenance notes; `vendor-rubric.sh`; private-rubric override; doc index; license statement |
| `docs/index.md` | 238 | Mixed — search arrivals, site nav hub | "Learn more" grouped nav (the site's only nav); doctor/leaderboard-team screenshots; the Status pointer |
| `docs/architecture.md` | 1,029 | Contributor / security reviewer | System diagram; the canonical 9-step score flow; **the complete Redis key inventory**; quiz/classic data flows; build-time config flow; security model; testing strategy; the Names table |
| `docs/decisions.md` | 2,693 | Contributor / security reviewer | 52 ADRs — the why. Largest doc by 2.5× |
| `docs/modules.md` | 963 | Module author | The normative contract (§1–§10): payload shape, login grammar, UI blocks, provisioning hooks, metrics contract |
| `docs/operations.md` | 1,096 | Organizer | Admin panel tab-by-tab; quiz/classic organizer guides + bundle formats; dev-stack; teardown; known limitations; **the authoritative Status section** (4 docs point here) |
| `docs/hosting.md` | 641 | Organizer | The canonical quickstart (self-declared, correctly); provisioning steps; poll-vs-push; GitHub App/OAuth; event.yaml schema; rebuild rules |
| `docs/scorer.md` | 522 | Rubric/module author | Both rubric grammars; the vacuous-pass discipline; image build/mirror; consumer workflow; per-target boot strategies |
| `docs/aws.md` | 99 | Organizer | Terraform EC2 single-shot deploy |
| `docs/fly.md` | 345 | Organizer | One-Fly-machine deploy; IPv6/srh post-mortem; secrets reality |
| `docs/security-checklist.md` | 158 | Organizer (security-minded) | The 8-check pre-event walk; explicit non-goals; the better-auth `disabledPaths` check (documented nowhere else) |

**Overlap that will drift** (each topic, most-complete copy in bold):

1. **Quickstart/bring-up** — 5 places: README, index, **hosting.md (canonical, and says so)**, architecture.md (mechanism), aws/fly (embedded). Plus a 5th copy of the `EVENT_CONFIG_B64` warning in AGENTS.md. Acceptable shape — satellites point at hosting.md — but the satellites restate the command instead of only linking it.
2. **Module descriptions** — 6 places; README ↔ index feature tables are ~85% verbatim duplicates and have *already* drifted apart (the `flags.jpg` alt text describes the pre-#209 card board in README, the current tile board in index).
3. **Score data flow** — 5 places (**architecture.md**); the comment-marker trust filter alone is explained in five documents.
4. **Pause/freeze semantics** — 5 places (**architecture.md**); the three-reader lockstep rule lives in architecture.md, ADR 32, and AGENTS.md.
5. **Redis keys** — 4 places (**architecture.md** by far).
6. **Env config** — 5 places (**hosting.md**).
7. **Security model** — 6 places (**architecture.md** for mechanism, security-checklist for operator actions).
8. **Poll vs push** — 8 places (**hosting.md**); the "`score_ingest` in event.yaml is documentation-of-intent, nothing syncs it" caveat is stated in three.

Overlap verdict: the hub-and-satellite shape is right; the fix is making
satellites *link* rather than *restate*, and repairing the two places where
copies already contradict each other (B.2 items 1, 3).

---

## B. Drift report

Everything here was verified side by side. Grouped by what it is: **B.1 code
bugs the docs exposed** (you asked to see these, not have them prose-fixed),
**B.2 wrong docs**, **B.3 minor/stale details**, **B.4 structural link rot**,
**B.5 fragile duplication** (correct today).

### B.1 Bugs, not prose — docs describe behavior the code doesn't deliver

These need code fixes or explicit doc admissions; I will not silently rewrite
the docs to match broken behavior without you seeing them first.

1. **The AWS deploy path is broken.**
   DOC `docs/aws.md:44-59` presents a working flow ending in `docker compose --profile poll --profile app up -d --build`.
   CODE `deploy/aws-terraform/user-data.sh.tftpl:62-75` writes a `.env` with no `REDIS_PASSWORD`; `docker-compose.yml:82,150` reads `${REDIS_PASSWORD:?}`. The documented bring-up fails at compose interpolation. `deploy/aws-terraform/README.md:26-33` (SSM parameter list) and `userdata.tftest.hcl` lack it too — so the tftest that exists to catch exactly this class of bug doesn't cover it.
2. **`ALLOW_INSECURE_EVENT_URL` can't reach the container.**
   DOC `docs/hosting.md:503-508` (and `.env.example:22`) documents it as a settable knob.
   CODE `docker-compose.yml:21-33` — the `app` service's `environment:` never passes it; `apps/web/src/instrumentation.ts` reads it at runtime. Setting it in `.env` on the compose stack does nothing.
3. **`CHALLENGES_GATE_ENABLED` — same plumbing gap.**
   DOC `docs/operations.md:1026-1027` documents the pre-event gate as switch-on-able.
   CODE `apps/web/src/lib/gate.ts:20-21` reads the env vars; compose never passes them; they're absent from `.env.example`. On the documented stack the gate cannot be enabled, and no doc says where to set it.
4. **Contestant UI states a falsehood.**
   CODE `apps/web/src/app/page.tsx:337` — "Each app is a well-known, deliberately vulnerable OWASP project." DVWA (`digininja/DVWA`) and VAmPI (`erev0s/VAmPI`) have never been OWASP projects (per `setup/targets.tsv` itself). This is a UI string, i.e. a code change.
5. **Stale code comment contradicting its own line** (the one class of source edit you authorized): `apps/web/src/app/(site)/leaderboard/page.tsx:52` says "Penalties BEFORE module contributions"; line 64 runs `withHintPenalties` last. `docs/architecture.md:181-192` documents the correct order and why. I'd fix the comment in Phase 2 and tell you.

### B.2 Major drift — confidently wrong docs

1. **The Status section is stale in the direction that matters most: it claims missing capability the kit now has.**
   DOC `docs/operations.md:1060-1096` (mirrored at `docs/index.md:225-232`, `docs/architecture.md:135-138,945-950`, ADRs 3/6): "Real, live-GitHub scoring depends on two changes landing in other OWASP-CTF repos" — (1) upstream scorer bearer auth, (2) `score-action` leaderboard inputs + machine comment.
   CODE: both ship in-kit. Bearer auth: `scorer/src/serve.js:34-52,345-346` (constant-time check, refuses to boot without a token). Push-mode inputs + gated machine comment: `scorer/consumer-workflow.example.yml:97,307-334,361-369`. `operations.md:1003` even contradicts its own Status section by calling the seed path "the scorer's real bearer-authed `POST /score`".
   What genuinely remains: item 3 (Security Shepherd `extractSolutionKey` accepts any 64–128-char hex run — vendored read-only, fix belongs upstream) and the srh-subset caveat. → Needs your ground-truth call, see F.1.
2. **`teams:`/`hints:` in event.yaml — retired keys documented as live** in `docs/hosting.md:512-513,603-604` and `docs/modules.md:28-29`. CODE: `event.yaml.example` carries a NOTE block saying they were deliberately removed and were never read; `apps/web/scripts/generate-event-config.mjs:126-128` warns on them. An organizer following hosting.md configures team play in a file that ignores it.
3. **"Classic has no hint system … planned for later PRs"** — `docs/operations.md:950-954`. CODE: shipped (#210): `apps/web/src/lib/classic-keys.ts:37`, `hint-store.ts:85`. modules.md §5 and architecture.md already know.
4. **Module enablement "stays build-time"** — `docs/architecture.md:623-624` (+ the settings-field table at 578-590 omitting `enabledModules`, and the boundary summary at :41). CODE: runtime since ADR 52 — `apps/web/src/lib/enabled-modules.ts:11-38`, `admin-store.ts:198,270,428-433`. modules.md:47-51 has it right.
5. **CI job list stale in both "authoritative" docs.**
   `docs/architecture.md:1009-1015`: "seven jobs" — actual `ci.yml` is `changes` + nine gated jobs (`sync-tests, scorer, vacuous, shell, smoke, app, quiz-only, classic-only, docs`); the list omits `vacuous` and `docs`.
   `AGENTS.md:53-54` shell commands omit what CI actually runs: `deploy/fly/deploy.sh deploy/fly/render-compose.sh` in shellcheck (`ci.yml:155`) and `bats deploy/fly/test/` (`ci.yml:170`).
6. **Scorer image/rubric "private" framing survives ADR 18's reversal** — `docs/architecture.md:75,108,927-931` ("private image … the expected path is … your own private rubric"), `docs/modules.md:657,672-674`. CODE: `scorer/Dockerfile:34-35` bakes the **public** vendored `rubric.owasp/` by default; scorer.md/README/ADR 18 state public-by-default.
7. **Leaderboard fold order inverted in modules.md** — `docs/modules.md:260-262` says the module overlay runs *after* `withHintPenalties`. CODE `leaderboard/page.tsx:64`: penalties run **last**. architecture.md:181-192 is correct (and explains why).
8. **README License section mischaracterizes the vendored content** — `README.md:262-263` "The vendored target apps under the rubric keep their own upstream licenses." No target apps are vendored; `scorer/rubric.owasp/` holds rubric test suites whose upstream is private and **unlicensed** (see D.3). Wrong on both halves.
9. **Rubric licensing / provenance** — see D.3; the drift is that LICENSE + README together imply a grant that doesn't exist anywhere.

### B.3 Minor drift and omissions

- `docs/architecture.md:441-442` — classic attempts row missing `firstAt` (`classic-store.ts:59`; modules.md:876 calls it load-bearing).
- `docs/architecture.md:794-802` — master-reset key enumeration omits `ctf:activity:log` (`admin-store.ts:540` has it in `RESET_PREFIXES`; prose elsewhere is right).
- `docs/architecture.md:997-1007` — testing-strategy table has no classic-only acceptance row (`ci.yml:218-224`; the prose below the table names it).
- `docs/modules.md:875` — quiz earned-row shape omits `choices` (`quiz-store.ts:44`); fine as a "fields the fold reads" minimum, surprising as a row spec.
- `docs/modules.md:280-293` — admin tab-shell components implied under `components/`; they live in `apps/web/src/app/(site)/admin/`.
- `docs/modules.md:681-682` — points at README's "Status / upstream dependencies", a section that doesn't exist (lives at operations.md).
- `docs/modules.md:791-793` — scorer image "referenced as `ghcr.io/owasp-ctf/score:latest`" overstates a compose *fallback* (`docker-compose.yml:62`) and contradicts hosting.md's "no default" posture.
- `docs/hosting.md:419-423` — "Which profiles do I need?" table has no classic row (classic-only is fully supported: `acceptance-classic-only.sh`, CI job).
- `docs/hosting.md` workflow-version samples are a generation behind (template is v3).
- `docs/operations.md:286-288` — hint gate misstated as per-module; it's per-target (`hint-store.ts:186`).
- `docs/operations.md` Shepherd hex window "32–128"; code is 64–128 (vendored `helpers.js:176-182`).
- Reset confirmation also accepts the literal `"RESET"` (`reset/route.ts:14`) — undocumented.
- Undocumented where docs enumerate siblings: `teardown` subcommand and `--config`/`--out` in hosting.md; `POLL_INTERVAL_MS`, `COMMENT_AUTHOR`, scorer `PORT`; vacuous-sweep `--personality`; classic bundle `caseSensitive`/`hint` fields (operations.md claims the bundle carries "exactly the fields the admin form collects"); `event.yaml.example`'s `oauth_client_id` has no reader (vestigial).
- Pointer rot: app's `outsideWindow` lives in `schedule-window.ts:16`, not `admin-store.ts` — architecture.md:596-598, ADR 32, and AGENTS.md:161-163 all point at the old home (this is the lockstep-edit pointer, exactly the one that must be right). ADR 31's `TEAM_MAX_MEMBERS` pointer stale (moved to `team-limits.ts:18`).
- `docs/architecture.md:~972` — "SameSite=Lax" rests on a better-auth default I could not confirm in-repo; will verify upstream or soften.
- architecture.md and decisions.md both send readers to **README** for "operator-facing instructions" — operations.md is that doc.

### B.4 Structural link rot (published site)

- **~45 cross-doc deep links into numbered headings silently break on the Jekyll site.** GitHub slugs keep leading digits (`#19-organizer-admin-panel…`); kramdown strips everything up to the first letter (`#organizer-admin-panel…`) and drops underscores. Every deep link into a numbered ADR or a numbered modules.md section works on GitHub and lands at page-top on the site. Affected: architecture.md ×17, hosting.md ×5, modules.md ×3, operations.md ×2, scorer.md ×3, fly.md ×1, security-checklist ×1, plus 12+ ADR-to-ADR self-links.
- Genuinely dead on both renderers: `decisions.md:1567` — a literal `[#43](#43-…)` ellipsis placeholder; fly.md's TOC entry `#region-and-volumes` (no such heading; the TOC also omits two real sections).
- fly.md missing the `[← Docs home]` backlink every other page has.

### B.5 Fragile duplication (correct today; consolidate or annotate)

- `GITHUB_LOGIN` regex quoted verbatim in 2 docs, defined 3× in code — all five identical today.
- Title ≤60 / blurb ≤200 in 3 doc places; team cap default/range in 3; classic cooldown numbers in 2; `ACTIVITY_LOG_MAX` 5000 in 2; attempts-row shape in 2 docs + 2 code headers (already drifted once — B.3).
- `SCORE_COOLDOWN_MIN = 5` is a code↔code lockstep pair (`scoring-defaults.ts:11` ↔ `consumer-workflow.example.yml:99`), in sync.

**Verified correct** (so the audit is falsifiable): all Redis key names; all
caps/units incl. the seconds-vs-minutes splits (AUDIT_CAP 500, ACTIVITY_LOG_MAX
5000, MAX_CONTESTANTS 2000, classic cooldown 5 s cap 3600, quiz retry 5 min);
all quoted regexes; the three-reader pause contract (all fail open); compose
profiles/networks byte-for-byte; every `ctf-setup.sh` subcommand and flag docs
quote; `dev-stack` and `smoke.sh` claims; per-target counts and points recomputed
exact (38/55/69/40/110/9 = **321**; 141/108/137/79/187/16 = **668**); the
targets.tsv table in hosting.md; the entire CTF_OUT_DIR/marker trust chain;
the vacuous-sweep tables cell-for-cell; every doc-referenced file path exists.

---

## C. Reader-path gaps

**The organizer** (teacher, chapter lead — possibly not a Docker expert) is the
best-served reader but is missing: a **no-GitHub quickstart** (quiz/classic-only
needs no org, no gh, no scorer image — yet README's quickstart leads with the
wizard and lists `gh` as a blanket prerequisite); a **troubleshooting runbook**
(the failure modes exist but are scattered as asides: `NOAUTH`, missing
`EVENT_CONFIG_B64` → empty admins, `{}` state file, frozen-ingestion confusion,
fork Action not commenting, the placeholder-comment revision bug); a **day-of
checklist** (security-checklist covers the security half only); and honest
hardware/scale expectations ("on what, by when").

**The evaluator** gets a good pitch but is missing: an above-the-fold **status**
statement in README (it exists only at the bottom of index.md and in
operations.md — and is stale, B.2.1); a **fair comparison** with CTFd/picoCTF
(the only mention is "CTFd-style graph"); explicit **non-goals**; and a
90-second read — the README is 263 lines with seven feature tables.

**The module author** is well served by modules.md + scorer.md. Missing: a
stated **proposal path** (CONTRIBUTING.md never mentions modules), and a
one-paragraph orientation ("read modules.md for the contract, scorer.md for
rubrics, architecture.md §quiz/classic for a worked example") at the top of
modules.md.

**The contributor / security reviewer** has architecture.md and the ADRs.
Missing: CONTRIBUTING.md with real commands (it defers everything to AGENTS.md
and contains a factually false release claim, D.2); an accurate CI job
walkthrough (both current descriptions are stale, B.2.5); a **glossary** — the
Names table covers the five project spellings but not target / module / rubric
/ probe / marker / fork / poll-vs-push / control plane; and the trust-boundary
story in one place (currently architecture.md security model + scorer.md threat
model + modules.md §6).

---

## D. OSS surface

Files all exist; content audit:

1. **LICENSE** — MIT, "CTF-in-a-box contributors", 2026. Fine — except the vendored-content carve-out problem (D.3).
2. **CONTRIBUTING.md** — covers layout, PR flow, Conventional Commits, AI-attribution rule. **Factually wrong**: "No release has been cut yet, and none should be tagged" — tags v0.1.0–v0.3.0 exist; apps/web is at 0.3.0. Also: no dev-environment section (Node 22, corepack, Docker, `scripts/dev-stack` never mentioned), no inline test commands (a contributor can't run anything from this file alone — the vacuous-sweep gate, acceptance scripts, and the `.next/server/app/index.html` must-not-exist check are invisible), no CI walkthrough, no module-proposal path.
3. **Rubric provenance/licensing — the serious one.** `scorer/rubric.owasp/PROVENANCE.md` exists and pins the upstream commit (counts match the trees exactly) but **names no licence**. The upstream repo `OWASP-CTF/dc34-owasp-secure-development-ctf` is **private with `license: null`** — no LICENSE/NOTICE/headers anywhere in the vendored tree, and root MIT doesn't carve it out, so the repo as published implicitly re-licenses ~250 files with no upstream grant on record. Same pattern, milder: `apps/web/VENDORED.md` pins `OWASP-CTF/ctf-owasp-org` (public, also `license: null`). Needs your input (F.2) — a docs pass can only state the truth, not create the grant.
4. **OWASP branding.** The app's hero is the OWASP logo (`page.tsx:167-175`) above the default event name **"OWASP CTF"** (`generate-event-config.mjs:12,20`) — a bare build reads as an official OWASP property. No affiliation/endorsement/trademark disclaimer exists anywhere in the repo (grep confirms). README/index call this default "neutral"; it is another organization's mark. Plus the false "OWASP project" UI claim (B.1.4). Honest counter-examples exist (architecture.md:1028 explicitly disclaims the registry namespace). Needs your call (F.3).
5. **SECURITY.md** — good reporting channel (GitHub private advisories), good in/out-of-scope split. Gaps: repeats the false "no versioned release" claim; **does not state that classic flags and quiz answer keys are stored plaintext in Redis and readable by every `/admin` user** — verified true (`classic-store.ts` keys `ctf:classic:flag`/`flagnorm`, `quiz-store.ts` `ctf:quiz:key`; admin edit forms return them verbatim; contestant paths never touch them).
6. **CODE_OF_CONDUCT.md** — Contributor Covenant 2.1, intact. Weakness: conduct reports route through the *vulnerability* reporting flow (visible to all repo admins — who may be the subject); no independent contact.
7. **Issue/PR templates** — solid; PR template is strong. Gaps: no module-proposal template; PR template's service checklist omits `deploy`, `scripts`, `.github/workflows`.
8. **dependabot.yml** — thorough (npm ×3, docker ×3, actions, compose) with documented grouping rationale. **Missing: `terraform` ecosystem for `deploy/aws-terraform/`.** Also: workflow templates under `setup/` pin actions outside `.github/workflows/`, invisible to the actions updater (silent staleness; doctor's version stamp detects but doesn't update).
9. **CHANGELOG / versioning** — no CHANGELOG.md; annotated tags are the de-facto changelog; repo-level versioning with apps/web/package.json as sole version carrier is real but written down nowhere; v0.4.0 uncut with nothing saying what gates it.
10. **README links none of it** — no Contributing/Security/CoC section or links; SECURITY.md's only inbound link is from security-checklist.md.

---

## E. The plan

### Principles

Hub-and-satellite stays: hosting.md keeps the canonical quickstart,
architecture.md keeps the keys/flows/security spine, operations.md keeps the
organizer runbook. Satellites get shorter and link instead of restating. No
document is deleted. Voice preserved — every "why" and every named bug stays.

**Anchor strategy** (fixes B.4 without breaking what works): retitle
digit-leading headings with a leading word — ADRs `## 19. Foo` → `## ADR 19 — Foo`,
modules.md `## 1. Module identity` → `## §1 — Module identity` style — because a
letter-first title produces the **same slug on GitHub and kramdown**, making
~45 currently-half-broken deep links work on both renderers. Cost: current
GitHub-only anchors change once; every internal link updated in the same
commit; the old anchors were already dead on the published site, so net
inbound breakage is strictly reduced. (Alternative if you prefer zero heading
churn: explicit `<a id>` shims — uglier, and GitHub renders kramdown `{#id}`
syntax as literal text, so shims are the only other portable option.)

### File-by-file

| File | Action | Why |
|---|---|---|
| `README.md` | **Rewrite** (Phase 1, own commit) | Add honest Status above the fold; add comparison/non-goals; lead quickstart with the no-GitHub path; trim 7 badges → 3 (CI, docs, license); fix License section (B.2.8); link CONTRIBUTING/SECURITY/CoC; fix stale flags alt text; keep the target table, voice, and rubric-secrecy note |
| `docs/index.md` | Rewrite (align, shrink) | De-duplicate the verbatim feature tables against README (keep the nav-hub role and screenshots); fix Status pointer content; same alt-text fix |
| `docs/architecture.md` | Fix drift, keep whole | B.2.4/5/6, B.3 items, add TOC; **not split** — it's the de-facto reference for keys and freeze semantics and 17 inbound deep links; splitting trades one long good doc for a cross-link maintenance problem (you said only if links survive; they'd survive but not improve) |
| `docs/decisions.md` | Fix in place | Mark #17 superseded-by-#18; fix `[#43]` placeholder and ADR 37's wrong anchor; amend ADR 8 (17/18 inverted its premise); refresh ADR 19 field list + stale pointers; fold the 3 unnumbered riders visibly under their ADRs; normalize heading format for anchors. Status-field inconsistency (only 42–50 have one): add `Status: Accepted` uniformly. **Per-ADR file split: proposed but your call (F.4)** |
| `docs/modules.md` | Fix drift | B.2.2/7, B.3 items (dead README pointer, component paths, `choices`, image fallback wording); add "where to start" para for module authors |
| `docs/operations.md` | Fix drift + rewrite Status | B.2.1 (the big one, pending F.1), B.2.3, B.3 items; keep as organizer hub |
| `docs/hosting.md` | Fix drift | B.2.2, classic profiles row, workflow-version samples, document `teardown`/`--config`/`--out`; stays canonical quickstart |
| `docs/scorer.md` | Light touch | Verified nearly clean; align private-image framing residue only |
| `docs/aws.md` | Fix after code fix | B.1.1 — doc change alone would be "document the breakage"; pair with the userdata + tftest fix (F.5) |
| `docs/fly.md` | Mechanical fixes | Backlink, TOC (dead + missing entries), drop dead `nav_order` |
| `docs/security-checklist.md` | Extend | Add the plaintext-flags/admin-visibility statement (mirrors SECURITY.md); add the operational day-of half as a second section (same file, no rename — keeps existing inbound links) |
| `docs/troubleshooting.md` | **Create** | The runbook: symptom → diagnosis → fix for the known failure modes (`NOAUTH`; missing `EVENT_CONFIG_B64` → 403 `/admin`; `{}` state file; frozen ingestion; fork Action silent; placeholder-comment revision bug; `REDIS_PASSWORD` interpolation error; srh reachability). Content exists as scattered asides; organizers need it findable at 9pm |
| `docs/glossary.md` | **Create** | Target, module, rubric, probe, catalogue, marker, fork, poll vs push, control plane, freeze vs window, the five project spellings (moved-pointer from architecture.md's Names section, which stays as a stub link) |
| `docs/README.md` | **Create** (thin) | GitHub-dir landing: per-audience "start here" table (below). Excluded from Jekyll via `_config.yml` so the site keeps index.md as home |
| `CONTRIBUTING.md` | Rewrite | Fix false release claim; dev env (Node 22, corepack, Docker, dev-stack); the real command per test layer inline; the ten CI jobs and what each proves; testing conventions (no testing-library, differential corpora, ADRs, the bats last-statement rule); module-proposal path |
| `SECURITY.md` | Fix | Plaintext-flags statement; fix versions section against real tags |
| `CHANGELOG.md` | **Create** | Backfill from the three annotated tags; note the versioning convention (repo-level tags, apps/web as version carrier) |
| `.github/dependabot.yml` | Add entry | `terraform` ecosystem for `deploy/aws-terraform` (config, one hunk) |
| `AGENTS.md` | Fix | Shell-command block (B.2.5), `outsideWindow` pointer, scorer command working-dirs |
| `apps/web/…/leaderboard/page.tsx` | Comment fix only | B.1.5 — the one authorized source touch; will be called out |
| `docs/DOCS-CHANGELOG.md` | Create (Phase 3) | The report you asked for |

Not proposing to delete or merge any document.

### Proposed `docs/README.md` index

> **Evaluating the kit?** README (front door) → [architecture](architecture.md) → [decisions](decisions.md).
> **Running an event?** [hosting](hosting.md) (stand it up) → [security-checklist](security-checklist.md) (before doors open) → [operations](operations.md) (during) → [troubleshooting](troubleshooting.md) (when it breaks). Cloud instead of a box: [aws](aws.md) / [fly](fly.md).
> **Writing a module or rubric?** [modules](modules.md) (the contract) → [scorer](scorer.md) (rubrics) → architecture's quiz/classic flows (worked examples).
> **Contributing?** [CONTRIBUTING](../CONTRIBUTING.md) → [architecture](architecture.md) → [decisions](decisions.md). Lost on a word: [glossary](glossary.md).

### Commit sequence (per your working style)

1. README.md (Phase 1, stop for review) → 2. code-bug fixes you approve from F.5 → 3. operations.md (incl. Status rewrite) → 4. architecture.md → 5. hosting.md + modules.md → 6. decisions.md (anchors + supersede marks) → 7. index.md + docs/README.md + glossary → 8. troubleshooting.md → 9. security-checklist + SECURITY + CONTRIBUTING + CHANGELOG + dependabot → 10. fly/aws/scorer touch-ups + AGENTS.md → 11. DOCS-CHANGELOG.md. One doc per commit, shown before moving on.

---

## F. Decisions I need from you

> **Resolved 2026-08-25:** (1) Status = ships in-kit, **unproven live**.
> (2) Licence will be added to the upstream repo and recorded here
> (PROVENANCE.md + NOTICE); honest pending-note until it lands.
> (3) Branding = **full fix**: docs disclaimer + change the default event
> name, demote the logo default, fix the false "OWASP project" UI line.
> (4) ADRs stay in **one file** (anchor fix + TOC).
> (5) **Apply all five** code fixes, each its own commit.
> (6) Anchors fixed by **retitling headings**.

1. **Status ground truth.** The docs (and your brief) say live-GitHub scoring depends on unlanded upstream scorer/score-action changes. The code says both shipped **in-kit** (`serve.js` bearer auth; `consumer-workflow.example.yml` push inputs + gated machine comment) — and REVIEW.md's audit agrees. Remaining true caveats: the Shepherd `extractSolutionKey` fidelity bias (upstream, vendored read-only) and the srh-subset-unverified note. Proposed new status line: *"Complete and tested offline; the full scoring path ships in-kit. Known fidelity gap: one Security Shepherd challenge can under-credit a correct patch (upstream helper). srh REST-subset coverage unverified end-to-end."* Confirm — has a live event actually exercised the GitHub path (the Fly box), or should it stay "unproven live"?
2. **Rubric licence.** Upstream is private and unlicensed. Options: (a) you control/ask OWASP-CTF to add a licence upstream, recorded in PROVENANCE.md + a NOTICE file; (b) an explicit grant statement from the upstream owner recorded the same way; (c) until then, a LICENSE carve-out + honest note ("vendored content used with upstream's permission, licence pending"). Which is true/available?
3. **OWASP branding.** Default event name "OWASP CTF" + OWASP logo hero + no disclaimer reads as official. Minimum (docs-only): add a non-affiliation note to README/docs and stop calling the default "neutral". Fuller (code): change the default name (e.g. "Secure Dev CTF"), demote the logo, fix the false "OWASP project" line (B.1.4). How far do you want to go?
4. **ADR split** — one file per ADR + index, or keep single-file with the anchor fix + TOC? (My lean: keep single-file; the anchor fix solves navigation, and 52 files is worse for grep and for the ADR cross-reference web.)
5. **Code fixes surfaced by the audit** — approve/decline each: (a) AWS `REDIS_PASSWORD` in userdata + README + tftest; (b) plumb `ALLOW_INSECURE_EVENT_URL` + `CHALLENGES_GATE_ENABLED`(+`_PASSWORD`) through compose `app.environment`; (c) `page.tsx:337` false OWASP claim; (d) the stale leaderboard comment; (e) dependabot terraform entry. All are small; (a)–(c) change runtime behavior, so they're yours to call. Alternatively I file them as issues and the docs state today's truth.
6. **Anchor strategy** — heading retitle (recommended, B.4/E) vs `<a id>` shims?
