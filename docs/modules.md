---
title: Module contract
---

[← Docs home](index.md)

# Module contract

**For module authors.** Read this for the contract a new vertical must
satisfy; read [scorer.md](scorer.md) for authoring rubrics inside the
existing `secure-development` module (the far more common task); read
[architecture.md](architecture.md)'s quiz/classic data flows for a worked
example of an app-side module end to end.

A **module** is a CTF vertical — a family of challenges with its own targets,
scoring logic, and provisioning steps — plugged into the CTF-in-a-box
platform (event config, sync/scorer pipeline, `ctf-setup`, leaderboard). v1
ships three registered modules: `secure-development` (the OWASP Secure
Development CTF patch-the-vulnerability format: fork target app, find + patch
the vuln, PR back, GitHub Actions scores the patch), `quiz` (a self-paced
single/multi-select question bank, authored in `/admin` and scored entirely
inside the app — no GitHub, `sync`, or `scorer` involvement at all), and
`classic` (a jeopardy-style flag board: organizer-authored challenges, each
hiding a flag, graded the instant a contestant submits a matching string —
scored entirely inside the app exactly like `quiz`, with no GitHub/`sync`/
`scorer` involvement either; §5 covers what its UI contract satisfies and
what it still doesn't, for both app-side modules). This document is
the contract a new
module (forensics, api-security, cloud, …) must satisfy to plug in, with
`secure-development` as the worked example throughout, since it is the one
module that actually exercises the GitHub-mediated scoring contract (§2–3,
§6–8) that `quiz` and `classic` deliberately bypass.

The platform sections of `event.yaml` (`event`, `github`, `admins`) are
shared (there is deliberately no `teams:` or `hints:` block — see ADR 31's
amendment; both are `/admin` runtime knobs). Everything module-specific — target list, challenge
catalogue, scoring transport — lives under `modules.<name>`. For the
higher-level split of what the control plane owns versus what a module
supplies, see the [platform-and-modules table](architecture.md#platform-and-modules);
the sections below are the enforceable contract behind it.

## 1. Module identity & config block

1. MUST live under a kebab-case key in `event.yaml`'s top-level `modules:`
   map — one config block per module. Example, `secure-development`'s block
   (`event.yaml.example`):

   ```yaml
   modules:
     secure-development:
       targets: [juice-shop, dvwa]    # any subset of the six
       score_ingest: poll             # poll | push
   ```

2. MUST state whether it can be **enabled at runtime**. Presence in
   `event.yaml`'s `modules:` is the STARTING set and the outage fallback, not
   the live truth: organizers switch modules on and off from `/admin` during an
   event, and the live set lives in `ctf:admin:settings`
   ([ADR 52](decisions.md#adr-52-modules-are-switched-at-runtime-secure-development-is-configured-at-setup)).

   A module is runtime-toggleable only if **everything it needs already
   exists** when the switch is flipped. Concretely, enabling it must require no
   more than a route, a nav entry, a tab and data it keeps in Redis. If it
   needs a **container** (`docker-compose.yml` profiles are chosen at
   `up` time and the app cannot start one) or **provisioning** (forks, an App
   installation, per-repo workflows — `ctf-setup.sh`'s work, holding a key the
   web tier deliberately does not have, ADR 41), it is configured at setup and
   its toggle must be **refused with the reason**, in both directions.
   `secure-development` is the worked example of the second kind; `quiz` and
   `classic` are the first.

   Disabling MUST NOT delete a module's data. Re-enabling has to restore the
   same board, or the toggle is a destructive action wearing a switch.

3. MUST NOT expect dynamic/plugin-style registration in v1. **Three**
   independent readers parse the same `event.yaml`, and each enumerates the
   module keys it knows explicitly, failing on anything else: the poll
   service's config loader (`sync/src/config.js`), the app's build-time
   generator (`apps/web/scripts/generate-event-config.mjs`), and the
   provisioning script (`setup/ctf-setup.sh`, whose `KNOWN_MODULES` is
   enforced by `check_known_modules`). In `sync`:

   ```js
   export const KNOWN_MODULES = ["secure-development", "quiz", "classic"];
   const unknown = Object.keys(modules).filter((k) => !KNOWN_MODULES.includes(k));
   if (unknown.length) throw new Error(`event.yaml: unknown module: ${unknown.join(", ")} (known modules: ${KNOWN_MODULES.join(", ")})`);
   ```

   An organizer who writes `modules.forensics: {...}` today gets a loud
   startup failure (`sync/test/config.test.js`, "rejects unknown module
   key"), not a silently ignored block. Note what `KNOWN_MODULES` means:
   the ids `sync` *tolerates* in the file, not the ids it scores — it scores
   exactly one, the separate `MODULE` literal. **An unknown key and a
   missing module are not the same failure.** `sync` rejects the former
   (any key outside `KNOWN_MODULES`, or `modules:` absent entirely) but
   tolerates the latter: `if (!mod) return null;` when
   `modules.secure-development` itself is simply not configured, which is
   what lets a quiz-only event run `sync` to a clean exit instead of a
   crash loop (see [the ADR](decisions.md#adr-24-tolerating-a-missing-module-vs-rejecting-an-unknown-one)
   for why the line is drawn there). All three lists MUST stay in step,
   because all three read the same file: an id the app accepts and `sync`
   rejects crash-loops the poller and silently freezes the leaderboard, and
   an id the app and `sync` accept but `ctf-setup.sh` does not aborts
   provisioning outright.

   Adding a module means extending all three readers to recognize the new
   key and validate its shape — the same way `secure-development`'s block
   requires a non-empty `targets` array drawn from a known target enum
   (`TARGETS` in `config.js`). What `setup/ctf-setup.sh` needs is the new key
   in its `KNOWN_MODULES` mirror (`check_known_modules`/`has_module`), for the
   same missing-vs-unknown distinction `sync` draws — see §7 below for what it
   gates. Its `yaml_targets` needs no change: that one is scoped to the
   `secure-development:` block by construction and provisions that module's
   forks only, so a module with its own provisioning adds its own step
   instead. Registration is deliberate, not dynamic; this is a v1 constraint,
   not a permanent architectural stance.

   A module is enabled by **being present** under `modules:` and disabled by
   being omitted. There is no `enabled:` key — a module MUST NOT invent one.

4. A module's config block is free to define its own shape beyond
   `targets`. Note that in v1 `score_ingest` is documentation-of-intent
   inside `event.yaml` — neither reader acts on it. The actual
   poll/push switch is the separate `SCORE_INGEST` env var consumed by
   `docker-compose.yml` and the Caddy profile. A module MUST keep any such
   config-file fields and the runtime env vars that actually implement them
   in sync until the loader is extended to read them.

## 2. Scoring ingestion contract (the hard boundary)

1. MUST submit every score through the single writer: `POST /score` on the
   local scorer. `sync/src/submit.js` is the only write path this repo
   implements — both the poll pipeline (`sync`) and push-mode
   (`score-action` POSTing directly) land on the same endpoint; there is no
   second write path. A module MUST NOT invent one.

2. Payload MUST be `{author, target, solved: string[], pr: number, sha:
   string}`, delivered as a bearer-authenticated JSON POST, and a success
   response is `202`:

   ```js
   // sync/src/submit.js
   const res = await fetchImpl(`${cfg.scorerUrl}/score`, {
     method: "POST",
     headers: { authorization: `Bearer ${cfg.scorerToken}`, "content-type": "application/json" },
     body: JSON.stringify(payload),
   });
   ```

   (`sync/test/submit.test.js`: "POSTs payload with bearer token, true on
   202".)

3. `author` MUST match the GitHub-login grammar before it is ever sent,
   because it becomes a datastore key on the scorer side:

   ```
   /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}(?:\[bot\])?$/
   ```

   (`sync/src/parse.js`, `GITHUB_LOGIN` — the comment there is explicit:
   "Same grammar the scorer enforces — author becomes a Redis key segment
   there.") A module's scoring path MUST validate any author string against
   this grammar before it reaches `POST /score`; never pass through an
   unvalidated string from PR/comment metadata.

4. Writes MUST be treated as monotonic/idempotent on the receiving end —
   modules MAY deliver at-least-once. `sync`'s own poller relies on this:
   on a submit failure it un-marks the comment as seen and retries on the
   next tick (`sync/src/index.js`, `tick()`: `rs.seen = rs.seen.filter((id)
   => id !== c.id); // retry next tick`), and replays of an already-applied
   score are expected to be no-ops on the scorer side, not double-counts.

## 3. Score transport options

1. **Push**: the scoring workflow POSTs directly to `${scorerUrl}/score`
   with a bearer token. Caddy only exposes the `/score` route externally
   when running in push mode — compare `caddy/Caddyfile.push` (has a
   `handle /score { reverse_proxy scorer:4000 }` block) against
   `caddy/Caddyfile.poll` (no `/score` route at all, `/score` has zero
   inbound network surface).

2. **Poll**: the workflow embeds a machine-readable HTML-comment block in
   its PR comment, `<!-- ctf-score: {...} -->` (`sync/src/parse.js`,
   `MARKER`), authored by the trusted workflow identity
   (`github-actions[bot]` — `cfg.commentAuthor`, default in
   `sync/src/config.js`). The poller filters comments by author **before**
   parsing the JSON block:

   ```js
   // sync/src/github.js
   comments: all.filter((c) => c.user?.login === cfg.commentAuthor),
   ```

   `scripts/smoke.sh` proves the trust filter: a forged comment authored by
   `mallory` carrying a valid `ctf-score` block is fetched but never
   scored, because it's dropped by the author filter, not by JSON parsing.
   A module using poll transport MUST post its score comment from the
   org-repo workflow context (e.g. a `pull_request_target` Action running
   as `github-actions[bot]`), never from a user-controlled identity —
   trust here is entirely the GitHub-authenticated comment author, not
   anything in the payload.

3. A new transport (e.g. a webhook relay, a different trust anchor) is a
   new `sync` adapter, not a config toggle. Propose it via an issue first;
   it changes the trust model, not just wiring.

## 4. Leaderboard mapping

1. The scorer exposes `GET /leaderboard`; the local test fixture
   (`test/fixtures/mock-scorer.mjs`) returns `{leaderboard: [{author,
   points, solved}]}` computed as one point per solved challenge ID — a
   simplified stand-in for smoke-testing, not the real scoring/pricing
   logic (that lives in this repo's scorer engine, `scorer/src/serve.js`'s
   `buildLeaderboard`). The real scorer's leaderboard entries carry, per
   author, points plus a per-target solved/total breakdown.

2. A module MUST define its own challenge catalogue: a fixed set of target
   keys (`secure-development`'s is the `TARGETS` enum in
   `sync/src/config.js` — `juice-shop`, `dvwa`, `webgoat`,
   `securityshepherd`, `vulnerableapp`, `vampi`) and, per target, a stable
   set of challenge IDs with known totals, so the leaderboard can render
   "solved / total" and unsolved counts read as remaining work, not as
   absent data. `secure-development`'s challenge IDs (e.g. `sqli-low`,
   `exec-low`, `restfulXss` — see the fixture score comments in
   `test/fixtures/mock-github.mjs`) are opaque strings scoped per target;
   the module owns their meaning.

3. Challenge IDs are stable keys once published — renaming one breaks
   provenance (a contestant's recorded solve no longer maps to any current
   challenge). Treat catalogue IDs like a public API: add, don't rename.

## 5. UI / presentation contract

**Honesty constraint up front:** the vendored contestant app (`apps/web/`,
see `apps/web/VENDORED.md`) now derives its module registry from `event.yaml`
rather than hardcoding a single module. `src/lib/modules.ts`'s
`enabledModules` maps every id under `event.yaml`'s `modules:` block (surfaced
through the generator, `apps/web/scripts/generate-event-config.mjs`, which
emits a structured `modules` array plus a derived back-compat `targets` array)
to a `ModuleDef` — display name, description, and nav entry are code-side
registry data (`REGISTRY` in `modules.ts`); whether a module is *live* is
entirely config-driven. Three ids are registered today, and — as of this
work — **all three are real, working modules**, not one module plus
registry-proving placeholders: `secure-development` (targets, catalogue,
GitHub-mediated scoring — the worked example throughout this document),
`quiz` (a self-paced single/multi-select question bank, scored entirely
inside the app — see
[docs/architecture.md#quiz-data-flow](architecture.md#quiz-data-flow) for its
data flow and `docs/operations.md`'s "Quiz" section for the organizer-facing
authoring/retry-knob guide), and `classic` (a jeopardy-style flag board,
also scored entirely inside the app — see
[docs/architecture.md#classic-data-flow](architecture.md#classic-data-flow)
for its data flow and `docs/operations.md`'s "Classic" section for the
organizer-facing authoring/cooldown guide). An id outside the
registry still fails the build loudly (`generate-event-config.mjs`'s
`validateModules`, mirrored by `sync/src/config.js`'s `KNOWN_MODULES` check).

Display metadata (item 1) and the enablement rule (item 4) now hold for real
across the app, not just as a filter over one hardcoded target list:
`src/lib/site.ts`'s `moduleNavLinks` splices a module's nav entry into the
header iff that module is enabled *and* defines a `nav` — all three modules do
now, `quiz`'s pointing at `/quiz` (`apps/web/src/app/(site)/quiz/`, rendering
`components/quiz-board.tsx`) and `classic`'s pointing at `/flags`
(`apps/web/src/app/(site)/flags/`, rendering `components/classic-board.tsx`);
the leaderboard pipeline's
`withModuleContributions` (`src/lib/leaderboard/module-contributions.ts`)
attributes `secure-development`'s scorer-sourced *gross* points (hint
penalties fold last, netting the final all-module total once — the module
blocks show gross, the row's `−N hints` marker reconciles them) into a
per-module `ModuleProgress`, and now *also* computes `quiz`'s and `classic`'s points
app-side and adds them into the combined total (never attributes them — the
scorer never sees a quiz question or a captured flag, so there is nothing of
theirs to attribute from) — see
the architecture doc for why secure-development and the two app-side modules
use different verbs there. An
expanded leaderboard row renders each enabled
module's own detail block (`components/module-detail.tsx`) instead of one
hardcoded shape — `secure-development`'s branch shows the existing
patched/target breakdown, `quiz`'s shows an answered/total count, `classic`'s
a solved/total count — with the
per-module heading suppressed while only one module is enabled, so a
single-module event's row reads exactly as it did before; `/profile` renders
the same per-module blocks for the signed-in contestant's own progress,
built off the same `ModuleDetail` renderer as the leaderboard rather than a
second one — the page's headline total was already net and correct before
this, what it was missing was the per-module breakdown behind it; the admin
panel
(`app/(site)/admin/admin-controls.tsx`) is a tab shell — one **Event** tab for the
control-plane settings that belong to the platform itself, then one tab per
enabled module, labelled with that module's organizer-resolved `title` — with
the four hint controls living in Secure
Development's tab (`app/(site)/admin/admin-secure-dev-tab.tsx`), the quiz's two retry-gate
knobs plus its full
question-authoring UI (`components/admin-quiz-controls.tsx`) in Quiz's, and
classic's submission-cooldown knob plus its full challenge/category
authoring UI (`components/admin-classic-controls.tsx`) in Classic's —
so the generic "No settings for this module yet." fallback that a module
tab renders when it defines no controls is, today, dead code for all three
shipped modules; it stays wired for whatever module ships next with no
settings of its own. Every module tab opens with an identity editor
(`app/(site)/admin/admin-module-identity.tsx`) for that module's title/blurb override (item 1
above); this is the same organizer-resolved name rendered in the tab label
itself, the nav, and the module's own page header — plus the leaderboard block
and the landing-page section heading on a *multi-module* event, both of which
are suppressed while only one module is enabled (see item 1 for the full
reach). The
landing page (`app/page.tsx`) is composed the same way: the platform frame
(logo, event name, dates, countdown, its own CTAs, Discord link, progress
card) stays code, and each enabled module's `home` block (item 5 above)
supplies the page's tagline, hero paragraph, "what to expect" section, and
optional CTA/extra section — so a quiz-only event's landing page never
mentions forks or patches. `/how-to-play` and `/rules` are composed the same
way from each module's `guide` and `rules` blocks (item 6 below), so the
step-by-step guide and the fair-play rules describe the game the event is
actually running — as are `/faq`, `/terms` and the 404's route directory
(item 7). The existing challenge
catalogue (item 2) and per-target solved/total leaderboard columns (item 3)
predate this work and satisfy those items for `secure-development`; `quiz`
and `classic` each satisfy the same items with their own semantics — a flat
answered/total count and a flat solved/total count respectively (item 3
below covers the difference). The organizer admin panel that was tracked as Spec B is still
built out — freeze, scheduled scoring windows, team-registration windows, hint
toggles/cost, demo seed, and the master reset (see `docs/operations.md`'s
"Organizer admin panel" and "Status and upstream dependencies"). What remains
open there is score adjustments and player removal — and offering this
vendored delta back to `OWASP-CTF/ctf-owasp-org` once upstream write access
opens.

What remains open from this work and the quiz work before it, so a real
third module isn't mistaken for a fully general n-module platform:

- **No per-module leaderboards or module switcher exist.** The leaderboard is
  one board; a module's contribution shows only as a row's expandable
  per-module breakdown, never a separate view. This is unchanged by `quiz` or
  `classic` going live — each added its own breakdown block, not a second or
  third board.
- **`sync` still doesn't score anything for `quiz` or `classic`, by design,
  not as a gap.**
  `sync/src/config.js`'s `KNOWN_MODULES` tolerates both keys purely so an
  `event.yaml` the app builds from can't crash-loop the poller (the two
  services mount the same file); `sync` still scores `secure-development`
  alone, because neither app-side module ever produces a score for GitHub to
  relay in the
  first place — both grade server-side inside the app's own Redis keys (see
  the architecture doc). Per-module `score_ingest`/rubric plumbing was for a
  module that needs scorer-mediated scoring; `quiz` and `classic` are proof
  one doesn't
  always need it, not evidence that plumbing is still missing.
- **No free-text questions, no partial credit, and no per-question
  attempt/cooldown overrides** — single- and multi-select only, all-or-nothing
  grading, and the two retry-gate settings (`quizMaxAttempts`,
  `quizRetryAfterMin`) are global, not settable per question.
- **`quiz` and `classic` both have bulk import/export, in one shared format.**
  Either tab can export its content as a single versioned JSON bundle and
  import one back — upsert by id, never deletes; classic additionally unions
  its categories rather than replacing them. See
  [ADR 36](decisions.md#adr-36-quiz-adopts-classics-bundle-format-rather-than-inventing-a-second-one)
  for why the two formats are deliberately the same, and
  [docs/operations.md](operations.md#quiz) /
  [docs/operations.md](operations.md#classic) for the organizer-facing
  contracts. Neither bundle carries its module's retry-gate settings: those
  are event policy, live-editable in `/admin`, and an import must never move
  them.
- **`classic` still has no file attachments — plainly, not by omission.**
  A challenge's `description` is Markdown text only, with nowhere to attach
  a downloadable file (an image, a pcap, a binary) for a contestant to pull
  down. Attachments are scoped to a later PR in this same series (#186).
- **`classic` HAS paid hints (issue #190).** An organizer attaches optional
  hint text in the admin classic form (or a bundle's `hint` field); the text
  is secret until purchased — its own hash, `ctf:classic:hints`, exactly the
  flag hashes' storage rule — and contestants buy it on the challenge's own
  page through the SAME reveal machinery, cost, gating knobs and penalty
  fold as secure-development's hints. The anti-burner gate counts solves on
  the whole classic board (categories are display groupings, not progress
  domains).

This section remains the contract a *new* module (forensics, api-security,
cloud, …) must satisfy to plug into the same UI: it is now proven against
three
real modules with genuinely different shapes — `secure-development`
(GitHub-mediated scoring, per-target progress), `quiz` (app-side scoring,
a flat answered/total count), and `classic` (app-side scoring, a flat
solved/total count) — which is what makes item 3 below a contract
about *defining your own progress semantics*, not an accidental description
of one module's shape.

1. **Display metadata.** A module MUST provide a human-readable display
   name, a short description, and a nav label, sourced from the module's
   own config/catalogue — never hardcoded into the app per module. Worked
   example: `secure-development` supplies "Secure Development" as its
   display name (not a string baked into `ctf-owasp-org`'s UI layer).

   A module's registry display name/description MAY be overridden at
   runtime by the organizer — a title (≤60 chars) and a blurb (≤200 chars)
   per module, editable from that module's own `/admin` tab, plain text only
   (control characters and Unicode bidi-override/isolate characters
   rejected), stored on the same `ctf:admin:settings` hash the rest of the
   runtime override layer uses (`moduleTitle:<id>`/`moduleBlurb:<id>` —
   decision 19's override-else-default precedence applies here too: leaving
   a field blank clears the override and restores the registry default,
   never stores an empty string).

   **Two resolved fields, and they are not interchangeable.**
   `ResolvedModule.title` is the module's name — the override if there is
   one, the registry `displayName` otherwise — and it is what a surface that
   has always shown the module's name must render.
   `ResolvedModule.titleOverride` is the organizer's rename *alone*, or
   `undefined`, and it is what a surface with its own established default
   must render *instead of* that default. The rule the platform follows, and
   a new module MUST follow: **an explicit rename replaces the module's name
   wherever it appears; with no rename, each surface's existing default
   stands unchanged.** The nav is the worked example —
   `secure-development`'s registry `nav.label` is "Challenges" while its
   `displayName` is "Secure Development", because one describes the
   destination page and the other names the module — so the nav reads
   `titleOverride || nav.label`, and an event that never touched `/admin`
   still says "Challenges". Reading `title` there instead renames the nav on
   every such event, which is a real bug this kit shipped and fixed. Same for
   `/challenges`, whose page title defaults to "Challenges", not to the
   module's display name.

   **Where a rename reaches, honestly.** On every event: the module's admin
   tab label, its nav link (header *and* footer), and its own page
   header/`<title>`. The header's convention changes once 2+ modules have a
   `nav` entry: `site.ts`'s `buildNavGroups` collapses them into one dropdown
   literally labelled "Challenges", whose items read each module's `title`
   (the override, or `displayName`) rather than `nav.label` — a dropdown
   called "Challenges" containing an item also called "Challenges" would be
   nonsense. A rename still reaches it, just through `title` instead of
   `titleOverride || nav.label`; the footer stays flat and keeps the
   `nav.label` convention regardless of module count (see `getNavLinks` vs.
   `getNavGroups` in `resolved-modules.ts`). Exactly one module still renders
   as a plain link, identical to a single-module event before grouping
   existed. Only on a **multi-module** event: the leaderboard's
   per-module block heading and the module's landing-page section heading —
   both are deliberately suppressed while a single module is enabled (there
   is nothing to disambiguate), and the landing page's uppercase kicker comes
   from the registry `home.tagline`, which is not overridable at all. So a
   single-module event sees three surfaces change, not five. (A module with
   no `home` block is the one exception: with no authored heading to prefer,
   its landing-page section is headed by its resolved `title`, so a rename
   reaches it even on a single-module event.)

   The **blurb** has a smaller reach than the title, but it is rendered copy,
   not metadata: it supplies the module page's meta description
   (`generateMetadata`) **and** that page's header lede — `/quiz` renders it
   under the title, where a per-viewer progress line used to sit. A module
   that has no registry `home` block also gets it as the lede of its
   landing-page section, so a module can ship a route and a sentence about
   itself before it ships hero copy. `secure-development` HAS a `home` block
   and its own page title, so it consumes the blurb only as a meta
   description; a new module should assume the blurb will be read by a
   contestant, not by a crawler alone.

   A module MUST NOT read its own registry `displayName`/`description`
   directly in any surface that names it — it must go through the resolved
   fields, or an organizer's override silently does nothing there.

2. **Challenge catalogue for UI.** A module MUST expose, per challenge: id,
   title, target/app grouping, and point value — built on the same
   catalogue and the same stable challenge IDs required for scoring (item
   4.2 above). The UI reads challenge titles and groupings from this
   catalogue; it MUST NOT need a code change per challenge to render a new
   one. Renaming a challenge ID breaks its UI history exactly as it breaks
   scoring provenance (item 4.3) — one stability rule, not two.

3. **Leaderboard presentation.** A module MUST define its own progress
   semantics: what columns and progress indicators the leaderboard/app show
   for it. Worked example: `secure-development` shows a patched/total count
   per target (e.g. `dvwa: <solved>/<total>`) across its up-to-six
   configured targets, `<total>` coming from that target's per-challenge
   count in the catalogue (item 4.2). Second worked example, proving the
   "MUST specify its own equivalent" clause for real rather than only in the
   abstract: `quiz` has no per-app grouping at all, so it shows a flat
   `<answered>/<total>` count instead (`ModuleDetail`'s `quiz` variant,
   rendered by `components/module-detail.tsx`) — a module with a different
   structure MUST specify its own equivalent rather than forcing the
   patched/total shape.

4. **Enablement rule.** A module's UI surfaces (nav entry, challenge list,
   leaderboard columns) MUST appear if and only if the module's key is
   present under `event.yaml`'s `modules:` map — the same map the config
   loader validates (section 1). Nothing about a module absent from
   `modules:` may leak into nav, leaderboard, or challenge listings; an
   organizer who omits a module from their event config gets an app with no
   trace of it, not a greyed-out or hidden-but-present surface. This reaches
   the module's own dedicated route, not just its nav entry: a disabled
   module's page MUST 404, not merely disappear from the header — worked
   example, `/challenges` (`app/(site)/challenges/page.tsx`) calls
   `notFound()` as its first statement when `secure-development` is
   disabled, the same gate `/quiz` already ran for its own module.



5. **Landing-page contribution (optional).** A module MAY contribute a
   `home` block to its registry entry (`ModuleHome` in
   `apps/web/src/lib/modules.ts`): an uppercase tagline, a hero `intro`
   paragraph, a "what to expect" heading/lede, numbered `steps`, an optional
   `cta` into the module's own route, and an optional full-width `extra`
   section. The platform frame (`app/page.tsx`) owns the logo, event name,
   dates, countdown, its own CTAs, the Discord link, and the
   progress-tracking card; it composes each enabled module's `home` block in
   registry order alongside that frame. A module with no `home` contributes
   nothing to the landing page — valid, not an error — and an event whose
   enabled modules all lack one still renders the frame on its own.

   `intro` and `steps` are **functions**, not static strings — they take a
   `HomeContext` (`appCount`, `appList`, `topAppsList`, `totalChallenges`,
   built once per render so two modules can't disagree about how many
   targets the event has) and must be called server-side, with only the
   resulting strings ever handed further down the tree. A module's `home`
   block MUST NOT be passed to a Client Component for this reason — see
   `docs/decisions.md`'s ADR on why `ResolvedModule` omits `home` entirely
   and server code reaches it through a dedicated accessor instead.

6. **Guide and rules contributions (optional).** The same split applies to
   `/how-to-play` and `/rules`, which used to be secure-development's
   workflow written out longhand — patch, fork, pull request — on every
   event, whether or not that module was enabled.

   A module MAY contribute a `guide` block (`ModuleGuide`): the page lede
   and meta description, an optional "the loop" callout, an optional callout
   above the steps, the numbered `steps`, an optional end-to-end `example`
   (with code blocks and a bonus note), "good to know" `notes`, a `scoring`
   paragraph and a `cta`. The platform frame (`app/(site)/how-to-play`) owns
   the page header, the "Good to know" and "How scoring works" cards, the
   links to the rules and leaderboard, and the organizer/Discord line, and
   composes each enabled module's block in registry order — with a per-module
   heading only when more than one module is guided, and each module's own
   lede promoted to the page lede when it is the only one.

   A module MAY also contribute a `rules` block (`ModuleRules`), bucketed by
   the `/rules` section it belongs in: `teams`, `fairPlay`, `conduct`,
   `scoring`. The platform keeps the section headings and the genuinely
   event-wide rules (team size, code of conduct, prizes, organizer
   decisions); a module owns every rule that names its own artifacts —
   targets, pull requests, patches, hints, questions. "Fair play" is written
   entirely by the modules — but the principles under it (don't collude,
   don't attack the platform) hold on any event, so the platform renders two
   generic fallback bullets if, and only if, no enabled module contributed
   any: a module that ships without a `rules` block must not leave a CTF with
   no anti-collusion rule at all. A section that ends up with no rules is not
   rendered.

   `guide.steps`/`guide.example` and `rules` itself are **functions** (of
   `GuideContext`/`RulesContext` — the target count and list, the GitHub org,
   the worked-example variant), so both fields carry the same server-only
   contract as `home`: called server-side, never handed to a Client
   Component, reached through `getModuleGuide`/`getModuleRules` and stripped
   from `ResolvedModule`. Copy is authored as plain data, not JSX; where a
   sentence needs inline markup it uses `Copy`/`CopySegment` (an emphasised
   phrase, a bold lead-in, an external link), rendered by
   `components/module-copy.tsx`. Nothing is written twice — a string lives in
   `home` or in `guide`, never in both.

7. **FAQ, terms and 404 contributions (optional).** The same split reaches
   the last three contestant-facing pages that were written as though every
   event ran `secure-development`.

   A module MAY contribute an `faq` block (`ModuleFaq`), bucketed by where
   its questions land in the platform's own running order:
   `gettingStarted` (before "Can I compete solo?"), `prep` (after it) and
   `playing` (the play loop). Buckets rather than one flat list because the
   platform's own questions are not all at one end — the page reads wrong if
   every module question is shunted to the top or the bottom. `/faq` matters
   more than its traffic suggests: it is in the **header nav**, so a page
   describing a game the event isn't running is linked from every page of
   the site.

   A module MAY contribute a `terms` block (`ModuleTerms`), bucketed by
   `/terms` section: `eligibility`, `scope`, `submissions`, `scoring`. Every
   participation term this kit has written names a module's own artifacts —
   what you submit, where you may test, what a point is worth — so the
   platform keeps only the two that hold on any event (prizes, organizer
   decisions) plus a **fallback list per section**, rendered if and only if
   no enabled module contributed to that section. The fallbacks are not
   decoration: with none, an event whose modules ship no `terms` renders an
   empty "Scope of authorized testing", and that section is the one that
   tells contestants what they are permitted to attack. (Before this, the
   scope statement was hardcoded secure-development copy and rendered as
   *"your authorization to test covers the 0 challenge targets only: ,"* on
   an event with no targets.)

   A module MAY contribute a `routeCard`: the one line under its card in the
   404's directory of routes. The card's label and href come from `nav`
   (`titleOverride || nav.label`, per the naming rule above), so the 404
   offers each enabled module's own route and never a route the event does
   not have.

   All three are **functions** (of `OrgContext`/`RulesContext`) and carry the
   same server-only contract as `guide`/`rules`: called server-side, reached
   through `getModuleFaq`/`getModuleTerms`/`getModuleRouteCard`, stripped
   from `ResolvedModule`.

   Two platform pages — `/privacy` and `/code-of-conduct` — are deliberately
   **not** composed from the registry. They describe the platform's own code
   and policies, not a module's game, so their module-specific claims (hint
   purchases, quiz answers, the GitHub org the code of conduct reaches into)
   are gated on `isModuleEnabled` instead. `/privacy` is an inventory of what
   this codebase stores, and which stores are live is per-event: it must
   neither promise a per-challenge breakdown an event has no notion of, nor
   stay silent about the answers a quiz-only event does keep.

8. **Pre-event gate.** The gate (`proxy.ts` + `/gate`) covers **every enabled
   module's own page route** — the exact `nav.href` each module registers —
   rather than the hardcoded `/challenges` it used to. `proxy.ts` derives the
   gated set from the registry (`enabledModuleRoutes`), and `/gate` sends an
   unlocked visitor to the first of them, falling back to `/`. Next requires
   `config.matcher` to be a static literal, so it cannot be computed — it
   lists every registry route by hand and `src/__tests__/proxy.test.ts`
   asserts it covers `ALL_MODULE_ROUTES`, so a newly registered module cannot
   end up silently un-gated. `proxy-quiz-only.test.ts` and
   `proxy-disabled-module.test.ts` pin what it then *does* with them.

   Know what this is and is not. The gate's route set is **page-only and
   exact-match**: it protects the module's page, not any deeper path under
   it, and it deliberately does **not** widen over `/api/*` — that would put
   the gate in front of `/api/auth/*` (breaking the sign-in a contestant
   needs in order to pass the gate) and `/api/gate` itself, and would answer
   API calls with a page *redirect*, which an API client can't act on. (The
   matcher literal itself also carries `/api/:path*`, but that entry serves
   the cross-origin write assertion, not the gate.)

   Instead, the three module routes that bank points or leak challenge
   content call a small server-side check of their own,
   `requireGatePassed()` (`src/lib/gate-request.ts`) — beside the gates they already
   run (`effectivePaused`, attempt caps, cooldowns), after authentication (so
   an unauthenticated caller still gets the more specific 401) and before any
   store read or write:
   - `POST /api/quiz/answer` and `POST /api/classic/submit` — bank points.
   - `POST /api/hints/reveal` — deducts points **and** returns hint text, so
     an ungated call would leak challenge content early, not just score
     early.

   A refused call gets **403 `{ error: "gate" }`**, never a redirect.
   `isGateActive()` is a module-load env read and `verifyGateCookie` is pure
   crypto — neither does I/O, so `requireGatePassed()` can never error
   mid-check; there is no fail-open/fail-closed case to make here, unlike the
   store-backed gates it sits beside.

   Deliberately **not** gated, on purpose: `/api/auth/*` (signing in is how a
   contestant passes the gate), `/api/gate` (the gate itself), `/api/admin/*`
   (organizers must be able to configure the event before kickoff — that's
   the entire point of a pre-event window), `/api/team/*` (team registration
   has its own separate window, `effectiveRegistrationOpen` — registering
   before kickoff is intended), `/api/stats/visit` (telemetry), and
   `GET /api/hints` (it returns the texts of hints the caller has **already
   purchased**, to a caller who must already be authenticated — it reveals
   nothing the buyer has not already paid for and cannot be used to read an
   unbought hint).

   This still is **not** an authorization boundary: it is a "the board opens
   at the keynote" curtain over a handful of scoring/content-leak paths, not
   a replacement for every API route enforcing its own rules
   (authentication, the pause/schedule window, attempt caps) independently —
   they must keep doing so, and a module MUST NOT treat "the gate is up" as
   a reason to skip a check in its own API. See `docs/operations.md`'s
   "Known limitations" for the operator-facing note.

## 6. Security requirements (non-negotiable)

1. Contestant code MUST run only inside sandboxed containers on an internal
   Docker network — never on the host, never with any token access. This
   is the `pull_request_target` pattern `secure-development` uses: the
   scoring workflow runs in the base (org) repo's context, where the org
   `GITHUB_TOKEN` (needed to pull the org-mirrored scorer image and read org
   secrets) lives, while the untrusted PR code under test executes in a
   sandboxed container on an internal Docker network with no access to
   that token — the isolation pattern the kit's own consumer workflow
   template (`scorer/consumer-workflow.example.yml`) implements, the same
   workflow `setup/ctf-setup.sh`'s `cmd_org` renders per target and commits
   into each forked target repo automatically (§7.2; the `render`
   subcommand's `dist/workflows/` output is the offline/manual alternative).
   A module MUST
   reproduce this isolation for its own scoring workflow, not just inherit
   it by accident.

2. **Oracle discipline**: contestant-visible output (PR comment, push/poll
   payload) MUST be pass/fail plus points only — never failing-test names,
   assertion messages, or exploit payloads. Verbose diagnostics stay in the
   private workflow log, visible to org admins only. This holds whether or
   not the rubric is private (the stock one ships public — ADR 18): an
   information-rich comment tells a contestant exactly which check to game,
   which is a worse oracle leak than the rubric text itself.

3. Scoring re-runs per submission MUST be rate-capped (e.g. N re-scores per
   PR per hour), so a contestant cannot brute-force the scorer's judgment
   with rapid speculative pushes. (`secure-development`'s shipped consumer
   workflow, `scorer/consumer-workflow.example.yml`, enforces this itself
   with a per-PR `concurrency` group plus a `COOLDOWN_MINUTES` gate; the
   upstream `score-action` path still doesn't — see
   [Status and upstream dependencies](operations.md#status-and-upstream-dependencies).
   Any new module's scoring workflow MUST ship its own cap regardless.)

4. **Stock-scores-zero invariant**: an unpatched, stock copy of a target
   MUST score 0. A module MUST ship a guard (a test or CI check) that
   proves this — feeding the scorer an unmodified target and asserting the
   result is zero points — so a rubric bug can never hand out free points
   for doing nothing.

   The invariant is enforced twice. `scripts/acceptance-scorer.sh` proves it
   offline against a synthetic stock app (fast, no network), and
   `scripts/acceptance-target.sh <target> <stock-image>` proves it against
   each real stock target in CI. A challenge that passes against the stock
   app is a free point for every contestant and fails the build.

## 7. Provisioning & lifecycle hooks

**A module that needs no forks and no scored transport is a first-class
citizen, not a lesser one.** `quiz` is the worked example: it satisfies this
section by having nothing to provision at all — no repo to fork, no
workflow to install, no image to mirror, nothing to archive at teardown.
That MUST be a legitimate, fully-supported shape for a module to have, not
just a legitimate shape for a module to have *alongside* one that does need
provisioning. Concretely, that means `ctf-setup.sh org`/`render`/`doctor`
MUST tolerate `secure-development` being the *only* provisioning-needing
module and simply absent — not merely tolerate it being present alongside
`quiz` — and report "nothing to provision/check" rather than erroring
(`has_module secure-development` gates each of the three; see the ADR
referenced in §1.2). A module standing alone this way still owes the rest of
the contract in full: display metadata (§5.1), a challenge catalogue if it
has one (§4.2/§5.2), its own leaderboard progress semantics (§5.3), and the
UI composition surfaces in §5.5/§5.6 — "first-class" means the platform
never assumes a *different* module is also enabled, not that this module
gets to skip sections that apply to it.

`ctf-setup.sh` implements `secure-development`'s provisioning today
(`setup/ctf-setup.sh`, `cmd_org` / `cmd_teardown`):

1. **Fork** each configured target into the event org
   (`gh repo fork "$(prov_field "$t" 2)" --org "$org" --fork-name "$name"`).

   **`setup/targets.tsv` is the canonical source of both halves of that
   command.** Its `upstream_repo` column names what is forked (`digininja/DVWA`,
   `erev0s/VAmPI`, …, pinned to the `ref` column), and `prov_repo_name` — the
   basename of that same column — names the fork. Nothing else decides a fork's
   name; every other place that spells one out is a **copy**, and there are two
   that matter: `sync/src/config.js`'s `REPO_NAMES`, which decides the repos the
   poller reads score comments from, and `apps/web/src/lib/apps.ts`'s, which
   builds the fork links contestants click.

   Both copies are pinned to the tsv by a differential test on each side
   (`sync/test/repo-names.differential.test.js`,
   `apps/web/src/lib/__tests__/apps-repo-names.differential.test.ts`), and
   `setup/test/ctf_setup.bats` pins the derivation itself. That matters because
   the drift is silent in both directions: a wrong name gives contestants a fork
   link that 404s, or — quieter — leaves the poller watching a repo nobody
   opens PRs against, so scoring stops for that target while every service
   still looks healthy. **A module adding a target adds it to `targets.tsv`
   first**, and updates the copies to match; changing a copy alone is the bug
   the tests exist to catch (issue #149).
2. **Render + commit** the scoring workflow: `cmd_org` renders the in-repo
   template (`scorer/consumer-workflow.example.yml`) per target —
   substituting the event org, the target id, and a default `APP_URL` — and
   commits it as `.github/workflows/ctf-score.yml` on each forked repo's
   `ctf` branch, then disables the fork's inherited workflows. No manual
   install step. The standalone `render` subcommand writes the same files to
   `dist/workflows/<target>.ctf-score.yml` for offline inspection or a
   manual-commit fallback, without committing (no upstream access either way).
3. **Mirror** the scorer image into the event org's own private GHCR
   (`docker pull` whatever `SCORE_IMAGE` names — the organizer's own
   image; there is no upstream default — then `docker tag`/`docker push`
   to `ghcr.io/$org/score:latest`) so forked repos' Actions can pull it
   with their own `GITHUB_TOKEN` rather than organizer credentials.
4. **Teardown**: `gh repo archive "$org/$r" --yes` for every target repo,
   plus a manual reminder to uninstall the GitHub App and delete org
   Actions secrets — `ctf-setup.sh` does not do this automatically.

A new module MUST document its own equivalent of steps 1–4: what it forks
or provisions per event, what workflow/credentials it installs, and what
must be archived or revoked in teardown. The requirement that matters more
than the specific mechanism: **everything a module provisions for an event
MUST be archivable or revocable after the event** — nothing should persist
or keep working once the event org is torn down. `secure-development`
satisfies this because every provisioned artifact (forked repo, mirrored
image, installed workflow) lives entirely inside the disposable per-event
org.

## 8. Versioning

Targets MUST be pinned to exact versions/digests — never `:latest`.
`secure-development` inherits this from its upstream: the event org's fork
of each target is "pinned to the canonical vulnerable version" (the
upstream `OWASP-CTF/<target>` repo already sits at a known-vulnerable
commit; `gh repo fork` copies that state as-is, so the fork "inherits the
correct pinned vulnerable version" rather than tracking upstream `HEAD`).

The reason this is load-bearing, not cosmetic: the scoring rubric is
regression tests written against a specific vulnerable version. If a
target silently moved to `:latest` or rebased onto a newer upstream commit,
an unrelated upstream fix could patch a vulnerability the rubric still
expects to be exploitable — deflating every contestant's score on that
challenge to zero regardless of their actual patch — or, in the other
direction, an upstream regression could reintroduce a vuln the rubric
already assumes is gone, inflating scores for a patch nobody wrote. Pinning
the target version is what keeps "score reflects patch quality" true. A new
module MUST pin its targets the same way and MUST NOT configure any target
or scoring dependency (image, base repo, library) to float on `:latest` or
an unpinned branch.

(Note: the *scorer* image is whatever `SCORE_IMAGE` names — your own build;
`docker-compose.yml` keeps `ghcr.io/owasp-ctf/score:latest` only as a
parse-time fallback the kit does not assume access to. Either way it is a
platform-level concern, not a module-authored target, and separate from the
target version pinning above. The reference
implementation of the scorer contract lives in this repo at `scorer/` —
one image, serve + judge modes — and [docs/scorer.md](scorer.md) documents
authoring a rubric and building your own image against it.)

## 9. Adding a module: files you will touch

A new vertical is a code change, not config alone (§1.2). Today its definition
is not yet co-located in one directory (a tracked follow-up — the scorer, sync,
and app are separately built images, so a single shared manifest needs a
build-time vendoring step first). Until then, a new module `<name>` with target
`<t>` touches:

| File | What to add |
|---|---|
| `sync/src/config.js` | add `<name>` to `KNOWN_MODULES`; add `<t>` to `TARGETS` + `REPO_NAMES` |
| `apps/web/scripts/generate-event-config.mjs` | mirror the module-key + target validation |
| `apps/web/src/lib/modules.ts` | register the module's display name / description |
| `apps/web/src/lib/apps.ts` | add `<t>` to `AppId` / `REPO_NAMES` / `apps[]` |
| `scorer/src/targets.js` | add `<t>`'s scoring shape (`name` / `catalogueFile` / `byName` / `defaultConcurrency` / `urlEnv`) |
| `scorer/entrypoints/<t>.sh` | the target's bring-up |
| `scorer/rubric.owasp/<t>/` | the vendored rubric, with its catalogue at `tests/challenges/catalogue.<t>.json` |
| `setup/ctf-setup.sh` | add `<name>` to `KNOWN_MODULES` |
| `apps/web/src/lib/metrics-store.ts` | add `<name>` to the per-login read list, the `earnedRows` fold and the `modules` split, or Insights reports nothing for it (§10.4) |
| `apps/web/src/lib/activity-keys.ts` | add a `<name>-solve` type and call `logActivity` from the module's submit route on FRESH solves only (id in `detail`, never the answer), or the admin Activity tab never sees the module |
| `event.yaml.example` + README target table | document the target |

Parity guards catch the most common drift: `scorer/test/targets.test.js`
(targets.js ↔ entrypoints ↔ rubric dirs) and `apps/web` `apps.test.ts` /
`apps-catalogue.test.ts` (apps.ts ↔ sync config ↔ catalogue). Run the full test
suite after adding a module — a mismatch across these lists fails loudly.

The table above is the worked example for a module with a **target and a
scorer** — the shape `secure-development` has. A module with no target and no
scorer-mediated scoring at all (`quiz`, and now `classic`) touches a
different, smaller set of files, since none of `scorer/`'s rows apply and
`setup/ctf-setup.sh`'s fork/render/mirror steps have nothing to do (§7).
`classic`'s actual footprint in this PR:

| File | What it added |
|---|---|
| `sync/src/config.js` | add `classic` to `KNOWN_MODULES` (tolerated so the shared `event.yaml` can't crash-loop the poller; `classic` never produces a score for `sync` to relay — §2) |
| `apps/web/scripts/generate-event-config.mjs` | mirror the module-key validation |
| `setup/ctf-setup.sh` | recognise the `classic` block; `org`/`render`/`doctor` report nothing to provision for it, same as `quiz` (§7) |
| `apps/web/src/lib/classic-keys.ts` | key names/builders, the flag comparison forms (`normalizeFlag`, `caseSensitiveFlagForm`, `flagComparisonForm`), challenge-id generation — dependency-free, shared by the client-side admin form and the server-only store |
| `apps/web/src/lib/classic-store.ts` | the module's own `ctf:classic:*` Redis store, its atomic flag-grading Lua script, and the admin/contestant secrecy split |
| `apps/web/src/lib/markdown.ts` + `apps/web/src/components/markdown.tsx` | the restricted Markdown parser and its node-tree-to-React renderer for challenge descriptions |
| `apps/web/src/app/api/classic/submit/route.ts` + `apps/web/src/app/api/admin/classic/route.ts` | the flag-submission and organizer-authoring wire contract |
| `apps/web/src/app/(site)/flags/page.tsx` + `apps/web/src/components/classic-board.tsx` | the contestant-facing board |
| `apps/web/src/components/admin-classic-controls.tsx` | the organizer's cooldown knob, category manager, and challenge authoring UI |
| `apps/web/src/lib/leaderboard/module-contributions.ts` + `apps/web/src/lib/leaderboard/team-fold.ts` | the leaderboard overlay (points added, never attributed) and the union-by-item team dedupe it shares with `quiz` |
| `apps/web/src/lib/modules.ts` | register display name/description/nav plus the `home`/`guide`/`rules`/`faq`/`terms`/`routeCard` copy blocks (§5.5–5.7) |
| `event.yaml.example` + `README.md` | document the module |

Nothing under `scorer/` or `scorer/rubric.owasp/` changes for a module shaped
this way — there is no target, no rubric, and no catalogue for the scorer to
know about.

## 10. Engagement-metrics contract (Insights)

The **Insights** tab (`GET /api/admin/metrics`, ADR 50) reports participation,
per-challenge difficulty, solves over time and hint usage. It has **no
collection step and no write path of its own**: every figure is a read over
keys the modules already maintain. That is the design constraint the rest of
this section follows from — Insights can only report what a module already
stores, in the shape it already stores it, and adding a metric is never a
reason to add a tracking write.

See [docs/operations.md](operations.md#organizer-admin-panel) for what each
figure means to an organizer and [docs/architecture.md](architecture.md#engagement-metrics-adr-50)
for the fold itself.

### 10.1 What a module must store to be measurable

Two per-login hashes, both keyed by **lowercased** GitHub login, both with the
**item id** as the field. A module that keeps them gets the full per-challenge
table for free; a module that keeps neither is still counted in participation
and points, and appears nowhere else.

| Hash | Field | Value | What it drives |
|---|---|---|---|
| `ctf:<module>:<earned>:<login>` — `ctf:quiz:answers:<login>`, `ctf:classic:solves:<login>` | item id | `{"points":<n>,"at":"<iso>"}` — the fields the fold reads; a module may store more (quiz rows also carry `choices`) | `scored`, the solves-over-time timeline, per-challenge `solves`, and the numerator of `solveRate` |
| `ctf:<module>:attempts:<login>` | item id | `{"attempts":<n>,"firstAt":"<iso>","lastAt":"<iso>","lastAtMs":<ms>}` | `attempted` and `stuck`, per-challenge `attempts`, `avgAttemptsToSolve`, `medianSecondsToSolve` |

Plus one aggregate the leaderboard already requires:

| Key | Field | Value | What it drives |
|---|---|---|---|
| `ctf:<module>:points` | login | integer | the per-module scorer split, and the per-team point sum |

Three rules about those rows, each of which has cost this repo a wrong number:

1. **`at` is when the item was EARNED**, not when the row was written. The
   timeline buckets on it, so a row stamped at import or seed time moves a
   solve to the wrong ten minutes.
2. **`firstAt` is the FIRST attempt and is carried forward** across every
   later attempt — both modules' Lua scripts re-read the existing row and keep
   the original (`quiz-store.ts` / `classic-store.ts`, `if not firstAt then
   firstAt = ARGV[…] end`). It is what makes time-to-solve knowable at all;
   overwriting it each try silently turns every duration into zero.
3. **The attempt row must survive the solve.** `avgAttemptsToSolve` and
   `medianSecondsToSolve` are computed *after* the fact, by matching the
   earned row against the attempt row for the same id. Clearing attempts on
   success destroys both figures and leaves the challenge looking
   first-try-easy.

Parse attempt rows with **`apps/web/src/lib/attempt-row.ts`**, never with
`Number(value)`. The row is JSON; `Number()` on it is `NaN`, which is how the
Support tab reported "0 attempts" for every contestant for two releases
without anything failing.

### 10.2 Item ids are the join key

Per-challenge stats are keyed `<module>:<item id>`, and the earned row and the
attempt row are matched by that id. This is the same stability rule as §4.3 and
for a second reason: renaming an id does not just orphan provenance, it splits
one challenge into two rows in the difficulty table — one with attempts and no
solves, one with solves and no attempts.

Ids must also be **unique within the module**. They do not need to be unique
across modules (the `<module>:` prefix separates them), but anything that
matches rows across two namespaces must carry both parts of the key —
`readSecureDevSolves` keeps the target in `<target>/<login>/<challengeId>`
precisely because challenge ids are unique within a target's catalogue and
nothing makes them unique between targets.

### 10.3 A module with no per-item rows

`secure-development` is this case, and it is a legitimate one. Its scores
arrive from GitHub already judged: there is a timestamped solve
(`ctf:solves:<target>`, field `<login>:<challengeId>`) but no attempt record,
because the attempts happened in a fork the box deliberately does not measure.
It therefore contributes to participation, points and hint ordering, and
contributes **nothing** to the per-challenge difficulty table or the timeline.

That absence is stated in the payload's own `caveats[]` rather than left to be
inferred from an empty row. **A module that cannot supply a figure must make
the gap visible, not render zero** — a blank cell reads as "no data", a zero
reads as "measured, and none".

### 10.4 Registration is NOT automatic

Adding a module does not add it to Insights. `computeEventMetrics`
(`apps/web/src/lib/metrics-store.ts`) names quiz and classic explicitly — the
per-login read list, the `earnedRows` pair it folds, and the `modules` split in
the response. A new module with both hashes still reports nothing until it is
added in those three places.

This is deliberate for now: the fold issues a fixed number of reads per
contestant, and a registry-driven version would make that number depend on how
many modules an event enables. It is a **known limitation**, recorded here so
the next module author finds it in the contract rather than in an empty tab.

### 10.5 What a module must NOT do

- **Do not collect from forks.** A fork can report far more — pages opened,
  time on a challenge, when someone gave up — and none of it credibly.
  Authenticating a fork means a credential every contestant can read, so any
  ingest endpoint is forgeable by the very people being measured. Engagement
  numbers a participant can inflate are worse than numbers that are merely
  incomplete. ADR 46's read-only, policy-only rule for `/api/public/scoring` is
  the other side of the same boundary.
- **Do not add a write purely to feed a metric.** If a figure needs a new
  write, it needs a decision record first: every per-contestant field added is
  one edit away from making an admin payload carry a login.
- **Do not read a module's aggregate counter where a fold over per-login rows
  will do.** `ctf:classic:solvecount` exists and would be a free classic-only
  shortcut; the fold deliberately ignores it, because folding per-login rows
  produces the same figure for **both** modules from one source. Reading both
  invites the two to disagree with no way to tell which is right.
