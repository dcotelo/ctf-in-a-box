# Design plan — the review queue

The redesign brief in one line: stop dressing this app as a hacker terminal
and design it as what it actually is — **the calmest code-review tool in the
room**. This event's soul is the fix, not the exploit: the unit of play is a
pull request that turns a red check green, a submitted answer that grades on
the spot. Every visual decision below derives from that.

## The concept

Three windows are open on a contestant's laptop: a terminal, a GitHub PR, and
this app. The first two already own "hacker dark" and "code review" — this
app's job is to be the **scoreboard and dispatcher** between them. Its native
visual language is the one the event already lives in: the status check, the
diff's red/green, the git graph.

Two ideas carry the whole system:

1. **The check is the score atom.** Everywhere a score exists — a leaderboard
   row, a solved challenge, a submission verdict, a profile stat — it renders
   in one shape: a status dot + verdict + points, like a CI check line.
   Pending is amber, passed is green, failed is red, untouched is hollow.
   When a score lands, the dot flips amber→green with one 300ms sweep
   (instant under `prefers-reduced-motion`). This is also how the
   scoring-latency problem gets a face: poll-mode delay stops being silence
   and becomes a visible "in review" state with an honest cadence label.

2. **The phase line is the signature.** A thin git-graph strip under the
   header on every screen: the event's phases as commits on a branch —
   `registration → live → frozen → results` — with a HEAD marker on now.
   One glance answers "what state is this event in", which is the single
   biggest thing the current app never says. On the landing page the phase
   line is the hero's spine; everywhere else it is a quiet one-line strip.

## Palette — 6 named values, and a stance

The stance: **color means scoring, nothing else.** Interactive chrome —
buttons, links, focus — is monochrome paper-on-ink. The only saturated hues
on any screen are the diff pair and the pending amber, so when green appears
it *always* means "you scored".

| Token | Hex | Role |
|---|---|---|
| `--ink` | `#0B0E14` | Page ground. Blue-black, deeper and more neutral than the old navy-purple. |
| `--paper` | `#E6EDF3` | Primary text and primary buttons. 13.9:1 on ink. |
| `--dim` | `#9BA7B4` | Secondary text, labels. 7.4:1 on ink — the muted tier passes AA with room. |
| `--diff-add` | `#3FB950` | Scored / solved / passing. Never decorative. |
| `--diff-del` | `#F85149` | Failed / danger / destructive confirm. Never decorative. |
| `--signal` | `#D29922` | Pending, attention, focus rings, the HEAD marker. |

Surfaces (panels, borders, input fills) are derived white-alpha overlays on
`--ink`, not named colors: `--panel` = white 4%, borders = white 9%. One
ground, one family.

**Single dark theme, kept deliberately.** The app sits between a terminal and
GitHub-dark; a light page between them is a flashbang. Projector survival is
handled by contrast floors (body ≥ 7:1, headings ≥ 13:1 — far above the old
theme) and by the leaderboard's display mode, which is the surface a
projector actually shows. This is a committed single-theme design: ground and
every color are painted explicitly.

## Type — three roles

| Role | Face | Why |
|---|---|---|
| Display | **Archivo** (700/900) | A grotesque with real shoulders — reads as signage, not as the default geometric. Used at h1/h2 and the scoreboard, tightly tracked, sentence case. |
| Body | **Public Sans** (400/600) | Designed for dense civic/technical text; survives long grading copy at 15px better than Barlow did. |
| Data | **Geist Mono** (kept) | Already bundled, excellent tabular figures. Everything numeric — points, ranks, counts, codes — is mono with `tabular-nums`, no exceptions. |

All via `next/font` (self-hosted at build) — nothing fetched at event time.

**Dies with this redesign:** the scanline overlay, the pulse-glow text
shadow, the `$ owasp-ctf` terminal prompt as logo, and blue as an accent.

## Layout concept

A single centered column (`max-w-5xl`), flat panels (1px white-alpha border,
no glow, no gradient), generous vertical rhythm. The header is one slim row:
event name (plain wordmark — no logo dependency), nav, one auth control. The
phase line sits directly under it, full width.

### Landing — a pitch with one door

```
┌──────────────────────────────────────────────────────────┐
│ Event Name        How to play  Boards  Standings   Sign in│
├──────────────────────────────────────────────────────────┤
│ ──●────────────●━━━━━━━━━━━━━━━━━━●─ ─ ─ ─○─ ─ ─ ─ ─○──  │  phase line
│  reg          LIVE ◀ HEAD        freeze         results   │
│                                                            │
│   {Event Name}                                             │
│   Patch real vulnerabilities. Answer for points.           │
│   Capture flags. One team, one board.        ← composed    │
│                                                            │
│   [ ▶ Primary action for THIS visitor state ]              │
│     how it works ↗                                         │
│                                                            │
│ ── right now ───────────────────────────────────────────  │
│  ✓ 1 Byte Me          1,458                                │
│  ✓ 2 Zero Cool          750     → full standings           │
│                                                            │
│ ── the games ───────────────────────────────────────────  │
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│ │ Secure Dev   │ │ Quiz         │ │ Classic CTF  │        │
│ │ patch → PR → │ │ answer,      │ │ find the     │        │
│ │ green check  │ │ score on     │ │ flag, take   │        │
│ │ 321 · 6 apps │ │ submit · 5   │ │ the points·12│        │
│ │ [Open board] │ │ [Open board] │ │ [Open board] │        │
│ └──────────────┘ └──────────────┘ └──────────────┘        │
│                                                            │
│ ── run this for your group ─────────────────── (evaluator)│
│  one box · no cloud · rubrics included    [GitHub] [Docs]  │
└──────────────────────────────────────────────────────────┘
```

Primary CTA by state: signed-out+pre-event → "Sign in to register";
signed-out+live → "Sign in and play"; signed-in teamless → "Join a team";
playing → "Open <their most-recently-active board>"; frozen → "See final
standings" (with the phase line saying why); ended → "See results". Grading
rules leave this page entirely — they live in How to play and at the point
of play.

### Challenge browser — a queue, not a card gallery

```
┌ Filters: [All targets ▾][OWASP ▾][○ unsolved ●][search…]  321 shown ┐
│                                                                      │
│ DVWA ──────────────────────────────────────── 6/55 ── sticky header  │
│  ✓ SQL Injection (Low)            A05   1 pt                         │
│  ✓ Command Injection (Low)        A05   1 pt                         │
│  ○ CSRF (Low)                     A01   1 pt                         │
│  ○ File Upload (Medium)           A05   3 pts                        │
│ Juice Shop ─────────────────────────────────── 5/38 ─                │
│  ○ Login Admin                    A05   2 pts                        │
│  …                                                                   │
└──────────────────────────────────────────────────────────────────────┘
```

One flat list, sticky per-target headers with solved counts, every row a
check atom (solved ✓ green / untouched ○ hollow). Filters: target, OWASP
category, solved-state toggle, text search. Default sort keeps catalogue
order; "unsolved first" is one toggle away — that's the "what's worth
attempting next" scan. Solved-state joins from the viewer's own profile data
the app already loads.

### Leaderboard — legible from the back of the room

```
┌ [Teams ●○ Individual]      [⛶ Display mode]        frozen? banner   ┐
│  score over time ── chart, labeled, as shipped ──────────────────    │
│                                                                      │
│  1  Byte Me            ████████████████████  1,458   ▾              │
│  2  Zero Cool          ██████████             750    ▾              │
│  3  The Plague         █████████              674    ▾              │
│ ── expanded ──                                                       │
│   ada-lovelace 397 · grace-hopper ♛ 1,061                            │
│   quiz ✓ 275 (4)   classic ✓ 1,125 (5)   ← check atoms               │
│   targets: Juice Shop 5/38 · DVWA 6/55 · …                           │
└──────────────────────────────────────────────────────────────────────┘
```

Rank and score jump two type sizes (Archivo + tabular mono). **Display
mode** (`?display=1` and a button): hides nav/search/chrome, top 10 only,
~2× type, auto-refresh — the projector surface. Phone: rows collapse to
rank + name + score, chart scrolls in its own box (already does).

### Play surface (flags / quiz) — progress beside the work

```
┌──────────────┬───────────────────────────────────────────┐
│ your run     │  Web ────────────────────────────────      │
│ ✓ 3 solved   │  ○ Robots Only                50 pts       │
│ ○ 9 open     │    …description…                           │
│ 70 pts       │    [flag input………………] [Submit]             │
│              │    ✓ Correct · +50 ← check atom lands here │
│ Web      2/4 │  ● Hidden in Plain Sight     150 pts       │
│ Crypto   1/3 │  …                                         │
│ Forensics0/2 │                                            │
│ (sticky nav) │                                            │
└──────────────┴───────────────────────────────────────────┘
```

Desktop: sticky left rail with per-category progress that doubles as jump
nav. Mobile: the rail becomes a horizontal chip row. Verdicts render in the
check atom; cooldown and attempts-left keep their current honest copy.

## Motion

Two animations total. (1) The check atom's pending→scored flip — 300ms, the
one moment worth celebrating. (2) The phase line's HEAD marker breathes at
4s. Everything else is instant. All of it inside
`@media (prefers-reduced-motion: no-preference)`.

## Copy

Rewritten where a contestant meets it: nav ("Boards", "Standings"), CTAs
(one verb, kept through the flow), verdicts ("Scored +50" / "Not this — try
again in 4s"), empty states as invitations. The module guides and rules
copy shipped this cycle (issue #200 tiers 1/4) were just corrected and
labeled — they are ported, not rewritten; rewriting them again would churn
verified copy for style points.

## Scoring latency — the honest version

The app never sees a contestant's PR, so a true per-PR pending→scored
lifecycle is a data-model change this brief forbids. What ships instead: the
Secure Development surfaces state the cadence in the check-atom vocabulary
("scores land within about a minute of your PR's checks finishing — this
board refreshes itself"), the profile and challenge browser show solved
state through the same atom, and the failure path is a written recovery
("check your PR's Actions tab; a run that scored 0 means the regression test
still fails"). The wall this hits is flagged in the PR.

## The self-critique (what got rejected on the way here)

- **Diff gutters as card rails** — first instinct, rejected: a colored left
  rail on rounded cards is the single most recognizable AI-design tell, and
  the semantics don't survive the cliché. The diff pair lives in the check
  atom instead.
- **Space Grotesk / Inter** — rejected as the default "safe" pick; Archivo +
  Public Sans give the same legibility with an actual voice.
- **Departure-board scoreboard with flap animation** — fun, rejected:
  second-most-predictable scoreboard aesthetic, and the flap motion fights
  reduced-motion users on the one screen everyone stares at.
- **Keeping blue as accent** — rejected; monochrome interactive chrome is
  the risk this design takes. If everything clickable is paper-white, the
  page reads calm and the semantic colors keep their meaning. The danger is
  flatness; type scale and the phase line carry the hierarchy instead.
- **A light theme** — considered for the classroom, rejected with a reason
  (see palette): this app lives between two dark windows.
