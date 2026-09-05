// CTF module registry. Registration is deliberate: a new vertical is code
// (an entry here) + config (a key under modules. in event.yaml) — never
// config alone. See the kit's docs/modules.md for the full contract.
import type { AppId } from "@/lib/apps";
import { eventConfig } from "@/lib/event-config";

export type ModuleId = "secure-development" | "quiz" | "classic" | "ai";

/** Context handed to a module's home-page copy so it can interpolate live
 *  facts (target counts, app names) without importing them itself. */
export type HomeContext = {
  appCount: number;
  appList: string;
  topAppsList: string;
  totalChallenges: number;
};

/** A module's contribution to the landing page. Plain data + pure functions —
 *  no JSX — so the registry stays importable from server and client alike. */
export type ModuleHome = {
  /** Uppercase kicker rendered under the event name. */
  tagline: string;
  /** The hero paragraph for this module. */
  intro: (ctx: HomeContext) => string;
  /** "What to expect" heading and lede. */
  expect: { heading: string; lede: string };
  /** Numbered how-it-works cards. */
  steps: (ctx: HomeContext) => { title: string; body: string }[];
  /** Optional CTA into the module's own route. */
  cta?: { href: string; label: string };
  /** Optional extra full-width section. */
  extra?: { kicker: string; heading: string; body: string };
};

/** OWASP's own playbook for pointing an AI agent at a codebase. It lives here
 *  rather than in `site.ts` because the module registry needs it (it is
 *  `secure-development`'s recommendation, and its copy links to it) and
 *  `site.ts` already imports THIS file — the other direction would be a
 *  cycle. `site.ts` re-exports it as `event.secureAgentPlaybookUrl` so there
 *  is still exactly one place the URL is written down. */
export const SECURE_AGENT_PLAYBOOK_URL = "https://github.com/OWASP/secure-agent-playbook";

/** A run of contestant-facing copy that needs a little inline markup.
 *
 *  The registry holds copy, not JSX (it must stay importable either side of
 *  the server boundary), but some sentences genuinely emphasise a phrase or
 *  link out mid-clause — "patch the root cause" bonus notes, the Secure Agent
 *  Playbook link in the rules. Modelling those as SEGMENTS keeps the registry
 *  free of JSX while rendering byte-identically to the hand-written markup
 *  they replaced; `components/module-copy.tsx` is the one renderer. */
export type CopySegment =
  | string
  /** A phrase lifted out of the surrounding sentence (`text-zinc-200`). */
  | { em: string }
  /** A phrase that leads its bullet (`text-white`). */
  | { strong: string }
  /** An external link, opened in a new tab. */
  | { link: { href: string; label: string } }
  /** A link to another page of this site, client-side routed. */
  | { route: { href: string; label: string } }
  /** An inline literal — a branch name, a command, a file path. */
  | { code: string };

/** Either a plain sentence or a segmented one — see `CopySegment`. */
export type Copy = string | CopySegment[];

/** Live facts handed to a module's `/rules` copy. Same idea as `HomeContext`,
 *  minus the landing page's catalogue-derived numbers, which `/rules` has no
 *  reason to fetch. */
export type RulesContext = {
  appCount: number;
  appList: string;
};

/** Live facts for copy that also names the GitHub org contestants work in:
 *  `/faq`'s submission answer and `/terms`' scope statement both interpolate
 *  it. Passed IN rather than imported by the registry so a module's copy stays
 *  a pure function of its context. */
export type OrgContext = RulesContext & { githubOrg: string };

/** Live facts handed to a module's `/how-to-play` copy: the org context plus
 *  which worked-example variant applies (see `workedExampleVariant` in
 *  `@/lib/apps`). */
export type GuideContext = OrgContext & {
  exampleVariant: "juice-shop" | "generic";
};

/** One numbered card in a guide's step list or worked example. */
export type GuideStep = { title: string; body: string; code?: string };

/** A module's contribution to `/how-to-play` — the long-form counterpart to
 *  `ModuleHome`.
 *
 *  Deliberately its OWN field rather than a reuse of `home.steps`: the two
 *  say different things at different lengths (the landing page's four short
 *  cards pitch the event; these five walk a contestant through their first
 *  submission, with a worked example, code blocks and caveats). Nothing is
 *  written twice — a string lives in `home` or in `guide`, never both. */
export type ModuleGuide = {
  /** The page's own lede, used verbatim when this module is the event's only
   *  guided one; a multi-module event falls back to the platform's. */
  lede: string;
  /** `<meta name="description">` copy for `/how-to-play`. Joined across
   *  modules, so keep it to a sentence. */
  metaDescription: string;
  /** The "the loop" callout: this module's play cycle, rendered as arrow-
   *  separated steps, plus the note under it. */
  loop?: { kicker: string; cycle: string[]; note: string };
  /** A callout above the numbered steps (secure-development's "Please use
   *  AI", which changes how you do step 4). */
  callout?: { kicker: string; body: Copy };
  /** How you play this module, start to finish. */
  steps: (ctx: GuideContext) => GuideStep[];
  /** An optional end-to-end worked example. `anchor` is the section's DOM id
   *  (`aria-labelledby`), authored here so two modules' examples can't
   *  collide on one page. */
  example?: (ctx: GuideContext) => {
    kicker: string;
    heading: string;
    anchor: string;
    lede: Copy;
    steps: GuideStep[];
    bonus?: { kicker: string; body: Copy };
  };
  /** "Good to know" bullets. Merged across modules into one list. */
  notes?: string[];
  /** The module's paragraph under the platform's "How scoring works". */
  scoring?: string;
  /** CTA into the module's own route, rendered alongside the platform's. */
  cta?: { href: string; label: string };
};

/** A module's contribution to `/rules`, bucketed by the section it belongs
 *  in. The platform owns the section headings and the genuinely event-wide
 *  bullets (teams, conduct, prizes, disputes); a module owns every bullet
 *  that names its own artifacts — targets, pull requests, patches, hints,
 *  questions — because those read as nonsense on an event not running it.
 *
 *  A function of `RulesContext` for the same reason `ModuleHome.intro` is:
 *  the scope rule interpolates the event's real target list. Server-only,
 *  therefore, and stripped from `ResolvedModule` like `home` and `guide`. */
export type ModuleRules = (ctx: RulesContext) => {
  /** Appended after the platform's team rules. */
  teams?: Copy[];
  /** The whole "Fair play" list: today every bullet in it names a module's
   *  own artifacts, so the platform contributes none. */
  fairPlay?: Copy[];
  /** Appended after the platform's conduct rules. */
  conduct?: Copy[];
  /** Prepended before the platform's prize and dispute rules. */
  scoring?: Copy[];
};

/** A module's contribution to `/faq`, bucketed by where it lands in the
 *  platform's own running order.
 *
 *  Buckets rather than one flat list because the platform's own questions —
 *  can I compete solo, is there a prize, where do I get help — are not all at
 *  one end: "Can I compete solo?" sits between a module's "do I need
 *  experience" and its "what do I need to bring", and the answer file reads
 *  wrong if the module's questions are all shunted to the top or the bottom.
 *
 *  Answers are `Copy`, not JSX, for the same reason every other block here is:
 *  the registry must stay importable either side of the server boundary.
 *  `/faq` renders them through `<ModuleCopy>`. */
export type ModuleFaq = (ctx: OrgContext) => {
  /** Opens the page, before the platform's "Can I compete solo?". */
  gettingStarted?: { q: string; a: Copy; id?: string }[];
  /** What a contestant needs on the day, after it. */
  prep?: { q: string; a: Copy; id?: string }[];
  /** The play loop: submitting, scoring, retrying, getting unstuck. */
  playing?: { q: string; a: Copy; id?: string }[];
};

/** A module's contribution to `/terms`, bucketed by section.
 *
 *  Unlike `/rules`, EVERY section here is module-owned, because every
 *  participation term this kit has ever written names the module's own
 *  artifacts: what you submit, where you may test, what a point is worth. The
 *  platform keeps only the two terms that hold on any event whatsoever (prizes
 *  and disputes) plus a fallback list per section for an event whose modules
 *  contribute none — a terms page with an empty "Scope of authorized testing"
 *  is worse than a generic one, since that section is the one that tells
 *  contestants what they are permitted to attack. */
export type ModuleTerms = (ctx: OrgContext) => {
  /** Who may take part and under which identity. */
  eligibility?: Copy[];
  /** What testing this event authorizes, and what it explicitly does not. */
  scope?: Copy[];
  /** What a contestant submits, and under what terms. */
  submissions?: Copy[];
  /** Prepended before the platform's prize and dispute terms. */
  scoring?: Copy[];
};

export type ModuleDef = {
  id: ModuleId;
  displayName: string;
  description: string;
  /** Nav entry, rendered iff the module is enabled (module contract §5.4).
   *  Omitted by a module that has no contestant route yet. */
  nav?: { href: string; label: string };
  /** Targets this module owns; empty for modules that have none (e.g. quiz). */
  targets: readonly AppId[];
  /** Landing-page copy for this module, composed into `app/page.tsx` by the
   *  platform frame. Optional: a module with no `home` simply contributes
   *  nothing to the landing page, which is valid, not an error. Server code
   *  reaches it through `getModuleHome` — never off a ResolvedModule, which
   *  strips it so the object stays safe to hand to a Client Component. */
  home?: ModuleHome;
  /** Long-form `/how-to-play` copy for this module, composed into that page
   *  by the platform frame. Optional, like `home`, and reached the same way:
   *  `getModuleGuide` in `@/lib/resolved-modules`, never off a
   *  ResolvedModule — `steps`/`example` are functions. */
  guide?: ModuleGuide;
  /** This module's `/rules` bullets. Same server-only contract as `guide`:
   *  it is a function, so it never rides on a ResolvedModule. */
  rules?: ModuleRules;
  /** This module's `/faq` questions, and its `/terms` clauses. Same
   *  server-only contract again — both are functions of live event facts. */
  faq?: ModuleFaq;
  terms?: ModuleTerms;
  /** One line describing this module's own route, for the 404's directory of
   *  routes. The card's label and href come from `nav`; this is the sentence
   *  under them. A function, so it can name the live target list — and so it
   *  is stripped from ResolvedModule like the rest. */
  routeCard?: (ctx: RulesContext) => string;
  /** What `/leaderboard`'s empty state says, and where it points, while this
   *  module is the way onto the board. The platform frame owns the empty
   *  state's framing ("the board is wide open"); the module owns the sentence
   *  that says how to get on it, because "patch your first challenge" is
   *  nonsense on an event that has no challenges. The first enabled module
   *  with one wins, so registry order decides on a multi-module event.
   *
   *  Plain data, deliberately — unlike `home` it survives onto ResolvedModule
   *  (a Client Component renders it), which only holds because there is no
   *  function here to break the RSC boundary. Keep it that way. */
  emptyBoard?: { line: string; cta: { href: string; label: string } };
};

// Display metadata per registered module. Registration is deliberate: an entry
// here plus a key under `modules:` in event.yaml — never config alone.
const REGISTRY: Record<ModuleId, Omit<ModuleDef, "targets">> = {
  "secure-development": {
    id: "secure-development",
    displayName: "Secure Development",
    description: "Find the vulnerability, patch it for real, ship the fix as a PR.",
    nav: { href: "/challenges", label: "Challenges" },
    // Moved VERBATIM off the leaderboard's EmptyBoard, curly apostrophe
    // included (the JSX spelled it `&rsquo;`, which React emits as U+2019, so
    // the rendered bytes are unchanged).
    emptyBoard: {
      line: "No flags captured yet. Every rank is unclaimed. Patch your first challenge and you’ll be the one everyone else is chasing.",
      cta: { href: "/challenges", label: "$ pick a challenge" },
    },
    // Moved VERBATIM off app/page.tsx, curly apostrophes included: the JSX
    // spelled them `&rsquo;`, which React emits as a literal U+2019, so the
    // rendered bytes are unchanged. Retyping them as ASCII "'" would be a
    // silent copy change no test would notice.
    home: {
      tagline: "Secure Development CTF",
      intro: (ctx) =>
        // "training apps", not "OWASP training apps": DVWA and VAmPI are
        // community projects, and the hero must not claim otherwise (the
        // targets section makes the same correction).
        `Break real vulnerabilities in ${ctx.appCount} deliberately vulnerable training ${ctx.appCount === 1 ? "app" : "apps"}, patch them for real, and ship the fix as a GitHub pull request. CI validates your patch and scores it automatically. Practice the full secure development lifecycle, not just flag-hunting.`,
      expect: {
        heading: "This isn’t flag hunting. It’s the real fix workflow",
        lede: "Every challenge maps to a real, disclosed vulnerability class from the OWASP Top 10. You find it, patch it, and prove the fix with a passing regression test, the same loop a security engineer runs against a live codebase.",
      },
      steps: (ctx) => [
        {
          title: "Pick a target",
          body: `Choose from ${ctx.appCount} real, deliberately vulnerable ${ctx.appCount === 1 ? "app" : "apps"}: ${ctx.appList}.`,
        },
        {
          title: "Find the vulnerability",
          body: "Work through the OWASP Top 10 (Web and API) to identify a real flaw in the target's source. Please use AI. Point an agent at the codebase. That's the workflow this event is built to teach.",
        },
        {
          title: "Patch it and open a PR",
          body: "Fix the vulnerability in your fork, then submit a pull request against the repo's main branch. This is secure development, not flag hunting.",
        },
        {
          title: "Get scored automatically",
          body: "A GitHub Action runs that challenge's regression test against your patched app. A passing test scores points immediately, no manual grading.",
        },
      ],
      cta: { href: "/challenges", label: "Browse targets" },
      // "Please use AI" belongs to THIS module, not to the platform frame: it
      // says writing the patch with an agent is the skill the event exists to
      // build, which in a quiz-only event would read as an invitation to cheat.
      extra: {
        kicker: "Bring your agent",
        heading: "Please use AI",
        body: "This isn’t tolerated, it’s the point. Reviewing code, finding the flaw, and writing the patch with an AI agent is the skill this event exists to build. Bring whatever you already use (Claude Code, Copilot, Cursor, your own harness) and let it read the target.",
      },
    },
    // Moved VERBATIM off app/(site)/how-to-play/page.tsx. Same rule as `home`
    // above: where the JSX spelled a character as `&rsquo;`/`&apos;`, this
    // holds the character React actually emitted (U+2019 and ASCII ' — they
    // are NOT interchangeable), so the rendered bytes are unchanged.
    guide: {
      lede: "New to the competition? Here's everything you need to go from a GitHub sign-in to your first patched challenge.",
      metaDescription:
        "Step-by-step guide to the OWASP secure development CTF: fork a target, patch a real vulnerability, open a PR, and get scored automatically.",
      loop: {
        kicker: "The loop",
        cycle: ["find the flaw", "patch it", "open a PR", "CI scores it"],
        note: "There are no flags to submit. Every challenge is scored by an automated regression test that only passes once the vulnerability is actually fixed.",
      },
      // Sits above the steps because it changes how you do step 4, and
      // contestants who skim only the numbered list still see it.
      callout: {
        kicker: "Please use AI",
        body: [
          "Solving these with an AI agent is the intended path, not a loophole. Bring whatever you already use and let it read the target. The fastest way to get a useful result is OWASP’s own ",
          { link: { href: SECURE_AGENT_PLAYBOOK_URL, label: "Secure Agent Playbook" } },
          ": structured, OWASP-grounded procedures for security code review, dependency and secrets scanning, and API assessment, mapped to the same Top 10 categories these challenges are graded against. Point it at your fork before you start reading files by hand.",
        ],
      },
      steps: (ctx) => [
        {
          title: "Sign in with GitHub",
          body: "Use the sign-in button in the header. Your GitHub login is how the leaderboard and your profile track your progress. The scorer credits points to the account that authors the pull request, so play from the same account you sign in with.",
        },
        {
          // Scores for this module arrive from GitHub through the poller, so
          // unlike quiz/classic there is no submission the box can refuse — a
          // teamless patch is silently ingested against no team. That is why
          // this step says "before you patch" instead of "or you'll be
          // refused" (see the team requirement in docs/operations.md).
          title: "Join a team, or play solo",
          body: "Scoring is per team. From your profile: create a team, join one by code or invite link, or hit Play solo for a one-click team of one. Do it before you patch — your PRs are scored either way, but points earned while you're on no team count toward no team's total.",
        },
        {
          title: "Pick a target and a challenge",
          body: `Browse the ${ctx.appCount} vulnerable ${ctx.appCount === 1 ? "app" : "apps"} on the Challenges page: ${ctx.appList}. Each has dozens of independent challenges at different difficulty levels; pick any one to start.`,
        },
        {
          title: "Find the vulnerability",
          body: "Work the target like a real audit: read the source, exercise the app, and identify the OWASP Top 10 flaw behind the challenge. Please use AI here. Point an agent at the codebase and have it do the analysis and draft the remediation. That's the intended workflow, not a shortcut around it.",
        },
        {
          title: "Patch it and open a pull request",
          body: `Fork the target's repo under the ${ctx.githubOrg} org, fix the vulnerability on a branch in your fork, and open a PR back against the repo's main branch. This is secure development practice, not flag hunting. The fix itself is the deliverable.`,
        },
        {
          title: "Get scored automatically",
          body: "A GitHub Action builds your patched app and runs the full regression suite against it. Every passing challenge test scores its points immediately: no manual grading, no waiting on an organizer. Pushing more fixes to the same PR re-scores it.",
        },
      ],
      // Two variants of the same loop (fork, branch, find the flaw, patch,
      // push, PR, get scored). The Juice Shop one is the Login Admin SQL
      // injection: the before/after mirrors routes/login.ts on the target's
      // default branch and the canonical parameterized-query fix, so a
      // contestant who follows it verbatim genuinely scores (and closes the
      // two sibling login challenges). The generic one names no app and no
      // app-specific path, for events where juice-shop isn't a target.
      example: (ctx) =>
        ctx.exampleVariant === "juice-shop"
          ? {
              kicker: "Worked example",
              heading: "Your first patch, end to end",
              anchor: "first-patch",
              lede: [
                "Here’s the whole loop on a real challenge: ",
                { em: "Login Admin" },
                " in Juice Shop, a classic SQL injection. Follow it verbatim to land your first points and see exactly what a scoring run looks like, then repeat the pattern on every other challenge.",
              ],
              steps: [
                {
                  title: "Fork the target and clone your fork",
                  body: `Fork ${ctx.githubOrg}/juice-shop on GitHub (or with the gh CLI), then clone it. The default branch is the one the scorer watches.`,
                  code: `gh repo fork ${ctx.githubOrg}/juice-shop --clone
cd juice-shop`,
                },
                {
                  title: "Create a branch for your fix",
                  body: "One branch per fix keeps your PRs clean and easy to re-score.",
                  code: "git checkout -b fix/login-sql-injection",
                },
                {
                  title: "Find the flaw",
                  body: "The Login Admin challenge (A05: Injection) lives in routes/login.ts. User input is concatenated straight into the SQL string, so an email like ' OR 1=1-- logs in as the first user in the table: the admin.",
                  code: `// routes/login.ts: the vulnerable query
models.sequelize.query(
  \`SELECT * FROM Users WHERE email = '\${req.body.email || ''}'
    AND password = '\${security.hash(req.body.password || '')}'
    AND deletedAt IS NULL\`,
  { model: UserModel, plain: true }
)`,
                },
                {
                  title: "Patch it",
                  body: "Replace string interpolation with bind parameters. The database driver now treats the email and password strictly as data, so they can never rewrite the query itself.",
                  code: `// routes/login.ts: parameterized fix
models.sequelize.query(
  'SELECT * FROM Users WHERE email = $1 AND password = $2 AND deletedAt IS NULL',
  {
    model: UserModel,
    plain: true,
    bind: [req.body.email || '', security.hash(req.body.password || '')]
  }
)`,
                },
                {
                  title: "Commit and push to your fork",
                  body: "Write the commit message like you would on a real security fix: say what was vulnerable and how the patch closes it.",
                  code: `git add routes/login.ts
git commit -m "Fix SQL injection in login route with bind parameters"
git push -u origin fix/login-sql-injection`,
                },
                {
                  title: "Open the PR against main",
                  body: `The base repo is ${ctx.githubOrg}/juice-shop and the base branch is main. The scorer only watches that branch. The GitHub web UI's “Compare & pull request” button works too; just check the base branch.`,
                  code: `gh pr create --repo ${ctx.githubOrg}/juice-shop --base main \\
  --title "Fix SQL injection in login route" \\
  --body "Replaced string-interpolated SQL with bind parameters."`,
                },
                {
                  title: "Watch the scorer do its thing",
                  body: "The ctf-score Action builds your patched app, boots it in a sandbox, and runs the challenge regression suite against it. When it finishes you'll get a “🏁 Score recorded” comment on the PR, and your points appear on the leaderboard and your profile moments later.",
                },
              ],
              bonus: {
                kicker: "Bonus",
                body: [
                  "That one-line fix doesn’t just close Login Admin. The same injection powers the ",
                  { em: "Login Bender" },
                  " and ",
                  { em: "Login Jim" },
                  " challenges, so a single parameterized query scores all three. Real fixes often cascade like this: patch the root cause, not the symptom.",
                ],
              },
            }
          : {
              kicker: "Worked example",
              heading: "Your first patch, end to end",
              anchor: "first-patch",
              lede: "Here’s the whole loop, end to end, on whichever target and challenge you pick: fork it, find the flaw, patch it, and open a PR. See exactly what a scoring run looks like, then repeat the pattern on every other challenge.",
              steps: [
                {
                  title: "Fork the target and clone your fork",
                  body: `Fork the target's repo under the ${ctx.githubOrg} org on GitHub (or with the gh CLI), then clone it. The default branch is the one the scorer watches.`,
                  code: `gh repo fork ${ctx.githubOrg}/<target> --clone
cd <target>`,
                },
                {
                  title: "Create a branch for your fix",
                  body: "One branch per fix keeps your PRs clean and easy to re-score.",
                  code: "git checkout -b fix/<short-description>",
                },
                {
                  title: "Find the flaw",
                  body: "Read the challenge description on the Challenges page, then trace it back to the vulnerable code in the target's source. Point an AI agent at the codebase if you want a head start on the audit.",
                },
                {
                  title: "Patch it",
                  body: "Apply the fix that closes the vulnerability class the challenge is testing for, without breaking the app's behavior for legitimate use.",
                },
                {
                  title: "Commit and push to your fork",
                  body: "Write the commit message like you would on a real security fix: say what was vulnerable and how the patch closes it.",
                  code: `git add -A
git commit -m "Fix <vulnerability> in <component>"
git push -u origin fix/<short-description>`,
                },
                {
                  title: "Open the PR against main",
                  body: `The base repo is the target's fork under ${ctx.githubOrg} and the base branch is main. The scorer only watches that branch. The GitHub web UI's “Compare & pull request” button works too; just check the base branch.`,
                  code: `gh pr create --repo ${ctx.githubOrg}/<target> --base main \\
  --title "Fix <vulnerability>" \\
  --body "Describe the fix and the vulnerability it closes."`,
                },
                {
                  title: "Watch the scorer do its thing",
                  body: "The ctf-score Action builds your patched app, boots it in a sandbox, and runs the challenge regression suite against it. When it finishes you'll get a “🏁 Score recorded” comment on the PR, and your points appear on the leaderboard and your profile moments later.",
                },
              ],
              bonus: {
                kicker: "Bonus",
                body: "A root-cause fix like this often closes more than one challenge at once, if several exercise the same underlying flaw. Real fixes often cascade like that: patch the root cause, not the symptom, and check whether your score picked up more than the one challenge you were aiming at.",
              },
            },
      notes: [
        "Every push to an open PR re-runs the scorer, and the run evaluates your whole app, so you can keep stacking fixes on one branch or open a fresh PR per fix, whichever you prefer.",
        "Your best-ever result per challenge is what counts. A later fix always replaces an earlier miss; you can never lose points by trying.",
        "Points are credited to the GitHub account that authored the PR. A challenge patched by several teammates counts once for the team, so a team's total can be less than its members' points added together.",
      ],
      scoring:
        "Every challenge is worth a fixed number of points based on difficulty, and harder vulnerabilities pay out more. Points are awarded the moment your PR’s regression test passes, and your best-ever result for each challenge is what counts, so a later fix always replaces an earlier miss. Your live total, per-app breakdown, and patched and non-patched counts are visible on your profile once you’re signed in.",
      cta: { href: "/challenges", label: "Browse challenges" },
    },
    // Moved VERBATIM off app/(site)/rules/page.tsx. Every bullet here names
    // something only this module has — targets, forks, pull requests,
    // patches, hints — which is exactly why none of them can stay in the
    // platform's own list.
    rules: (ctx) => ({
      // The generic "your GitHub login is your identity" sentence lives in
      // the platform's own Teams list now — three modules each restating it
      // rendered as three near-identical adjacent bullets (issue #200,
      // tier 4). This module keeps only the nuance the generic sentence
      // cannot carry: points credit the PULL REQUEST'S author, which is not
      // automatically the signed-in session.
      teams: [
        "Points for a patch credit the pull request's author — open every PR from the same GitHub account you sign in with, or your score lands on a row you can't see.",
      ],
      fairPlay: [
        `Only the ${ctx.appCount} challenge ${ctx.appCount === 1 ? "target" : "targets"} (${ctx.appList}) ${ctx.appCount === 1 ? "is" : "are"} in scope. Do not attack the CI scoring pipeline, the leaderboard, or other contestants' forks.`,
        "Submit your own work. Don't publish full solutions or patches for others to copy during the event.",
        "Automated mass-submission or spamming pull requests to farm scoring runs will get your account rate-limited or disqualified.",
        [
          { strong: "Please use AI." },
          " Finding and patching these vulnerabilities with an AI agent is the intended workflow, not a shortcut against the rules. It's the skill the event is built to teach. Start with OWASP's ",
          { link: { href: SECURE_AGENT_PLAYBOOK_URL, label: "Secure Agent Playbook" } },
          ".",
        ],
      ],
      conduct: [
        "Found a bug in a challenge, the scorer, or the site itself? Report it to an organizer instead of exploiting it for an unfair edge.",
      ],
      scoring: [
        "Each challenge is worth a fixed point value based on difficulty. Points post the moment your PR's regression test passes.",
        "Your best-ever result per challenge counts. A later successful patch always replaces an earlier miss.",
        "Revealing a hint deducts points from your total, and hint purchases are final.",
      ],
    }),
    // Moved VERBATIM off app/(site)/faq/page.tsx, which was 100%
    // secure-development — and is in the HEADER NAV, so a quiz-only event
    // linked contestants straight to a page telling them to fork a target and
    // open a pull request. The platform keeps only the questions that hold on
    // any event (solo play, prizes, finding an organizer); everything that
    // names a fork, a PR, a hint or a scoring run is here.
    faq: (ctx) => ({
      gettingStarted: [
        {
          q: "Do I need experience to compete?",
          a: "No. Every target has challenges across a range of difficulty, and points scale with it. Start with a low-point challenge on any app and work up.",
        },
      ],
      prep: [
        {
          q: "What do I need to bring?",
          a: "Your own laptop with the dev tools you like to work in, a GitHub account, and a charger (outlets go fast). Everything else runs in your fork and in CI.",
        },
      ],
      playing: [
        {
          q: "How do I submit a solution?",
          a: [
            `There's no flag to type in. Fork the target's repo under the ${ctx.githubOrg} org, fix the vulnerability on a branch in your fork, and open a pull request against the repo's `,
            { code: "main" },
            " branch. That's the only branch the scorer watches, and there is no per-challenge branch. A GitHub Action builds your app, runs the rubric, and posts your score on the PR, usually in two to five minutes. See ",
            { route: { href: "/how-to-play", label: "How to Play" } },
            " for a worked example.",
          ],
        },
        {
          q: "Do I need to run the target app locally?",
          a: "No. The scoring pipeline builds and runs your patched app in CI, so a PR is enough. Running it locally is just faster to iterate against while you work out the fix.",
        },
        {
          q: "Can I use AI tools to help?",
          a: [
            "Yes, ",
            { em: "please do" },
            ". Using AI to analyze and remediate these vulnerabilities is the skillset this event is built around, not something to hide or work around. Bring whatever you already use, and point it at your fork. OWASP's own ",
            { link: { href: SECURE_AGENT_PLAYBOOK_URL, label: "Secure Agent Playbook" } },
            " will get you further faster. It gives an agent structured, OWASP-grounded procedures for code review, dependency and secrets scanning, and API assessment, mapped to the same Top 10 categories these challenges are graded against.",
          ],
        },
        {
          q: "How is my progress tracked?",
          a: "Sign in with GitHub to claim your row on the live leaderboard and see a full per-app, per-challenge breakdown on your profile. Points are credited to the account that authored the pull request, so open your PRs from the same account you sign in with. Otherwise your score lands on a row you can't see.",
        },
        {
          q: "Are there hints?",
          a: "Some challenges offer one on your profile. Revealing a hint costs 10 points off your total, applied as soon as you reveal it, so save them for a challenge you're genuinely stuck on.",
        },
        {
          q: "My PR passed but I didn't get points. What happened?",
          a: "Check the scoring comment on the PR. If it says the score wasn't recorded, that's on our side. Push another commit and the run will record it. If it shows zero challenges patched, the rubric still reproduced the vulnerability, so the fix didn't fully close it. Points also only count for the PR author's account.",
        },
        {
          q: "Can I retry a challenge I didn't solve?",
          a: "Yes, as many times as you like. Push another commit and it re-scores. Your best-ever result per challenge counts, so a later fix replaces an earlier miss and you can never lose points you've already banked, even if a later patch breaks a challenge you'd already solved.",
        },
      ],
    }),
    // Moved VERBATIM off app/(site)/terms/page.tsx. The scope statement is the
    // reason this block exists: on an event with no targets it rendered as
    // "your authorization to test covers the 0 challenge targets only: ," — a
    // legal scope clause that authorized nothing and read as broken, on the
    // page that tells contestants what they are permitted to attack.
    terms: (ctx) => ({
      eligibility: [
        "You need a GitHub account. Your GitHub login is your identity for scoring, so open every pull request from the account you sign in with. Points are credited to the PR author and cannot be moved between accounts afterwards.",
        "Organizers and anyone who worked on the challenge targets, the scorer, or the rubric may compete for fun but are not eligible for prizes.",
      ],
      scope: [
        `Your authorization to test covers the ${ctx.appCount} challenge ${ctx.appCount === 1 ? "target" : "targets"} only: ${ctx.appList}, in your own fork under the ${ctx.githubOrg} organization.`,
        "Explicitly out of scope: the CI scoring pipeline, the leaderboard, this website, the CTF Discord, and other contestants' accounts, forks, or machines. Testing any of those is not authorized by this event, and nothing here should be read as permission to do so.",
        "Found a real vulnerability in the scorer or this site? That is genuinely useful. Report it to an organizer rather than exploiting it. Doing so will not cost you anything.",
        "Automated mass-submission, or spamming pull requests to farm scoring runs, will get your account rate-limited or disqualified.",
      ],
      submissions: [
        "You submit work as a pull request against the target repository's main branch. Those repositories are OWASP projects under their own existing open-source licenses, and your contribution is offered under the license of the repository you are contributing to.",
        "Submit your own work. Using AI tooling to find and fix vulnerabilities is expected and encouraged here (see the Rules), but passing off another contestant's patch as yours is not.",
        "Don't publish full solutions or patches for others to copy while the event is running. Afterwards, write up whatever you like.",
        "Organizers may reference or showcase submitted patches when talking about the event.",
      ],
      scoring: [
        "Each challenge is worth a fixed point value based on difficulty, awarded automatically when that challenge's regression test passes against your patched app. Your best-ever result per challenge counts.",
        "Revealing a hint deducts points from your leaderboard total. Hint purchases are final. There is no refund.",
      ],
    }),
    // Moved VERBATIM off app/not-found.tsx, where it was hardcoded alongside
    // a card linking to /challenges — a route that 404s on an event without
    // this module, reached from the 404 page itself.
    routeCard: (ctx) =>
      `Every challenge across the ${ctx.appCount} ${ctx.appCount === 1 ? "target" : "targets"}.`,
  },
  quiz: {
    id: "quiz",
    displayName: "Quiz",
    description: "Answer security questions for points.",
    nav: { href: "/quiz", label: "Quiz" },
    // The same shape as secure-development's, said in the quiz's own terms —
    // an event with no challenges cannot be told to patch one.
    emptyBoard: {
      line: "No answers banked yet. Every rank is unclaimed. Answer your first question and you’ll be the one everyone else is chasing.",
      cta: { href: "/quiz", label: "$ answer a question" },
    },
    // Deliberately plain and factual, and deliberately silent on AI: the
    // secure-development module invites an agent because patching WITH one is
    // the skill it teaches; on a graded question set the same invitation would
    // read as permission to cheat.
    //
    // Every claim below is checked against the implementation, because this is
    // contestant-facing copy and a landing page that promises something the
    // quiz doesn't do is worse than a plainer one that's true. Specifically:
    // there is NO topic constraint (upsertQuestion validates ids, choices and
    // points, nothing else), the UI never shows a remaining-attempts COUNT
    // (QuizQuestionView is unanswered | answered | cooldown | exhausted, and
    // quiz-board only says "No attempts remaining" once exhausted), the
    // attempt allowance itself is never rendered, and grading is exact-match
    // against a sorted key — all-or-nothing, including for `multi`.
    //
    // The copy DOES promise a leaderboard place, and that promise is true on
    // exactly the event this module exists for: `withModuleContributions`
    // takes the board's login set as the UNION of the scoring source's logins
    // and the ones holding module points, so a contestant whose only points
    // are quiz points gets a row CREATED for them rather than being invisible.
    // The promise was pulled once, while row creation was still an open gap;
    // it is back because the code changed. Check that function before pulling
    // it again.
    home: {
      tagline: "Quiz",
      intro: () =>
        "Answer security questions for points. Every question carries its own point value, is graded the moment you submit it, and counts toward your place on the leaderboard.",
      expect: {
        heading: "Straight questions, scored on submit",
        lede: "Each question is multiple choice: some have a single right answer, others are select-all-that-apply and only score if your whole selection matches. Grading is automatic, against a stored answer key. Organizers can cap how many times a question may be attempted and make you wait between tries; the question tells you when it is on cooldown and when you have run out of attempts.",
      },
      steps: () => [
        {
          title: "Sign in with GitHub",
          body: "Sign in to claim your row on the leaderboard. Your answers and points are recorded against your account, nothing is graded for a signed-out visitor, and signing in is what lets you leave and pick the set back up later.",
        },
        {
          title: "Work through the questions",
          body: "Take the set at your own pace. Each question shows what it is worth, and says so when it is on cooldown or out of attempts.",
        },
        {
          title: "Get scored on submit",
          body: "Your answer is graded immediately against the answer key. A correct answer scores its full points, a wrong one scores nothing, and either way there is no manual review.",
        },
      ],
      cta: { href: "/quiz", label: "Take the quiz" },
    },
    // The long-form guide, in the quiz's own terms. Same discipline as the
    // home block above: every claim is checked against quiz-store.ts and
    // components/quiz-board.tsx — grading is exact-match against a sorted key
    // (all-or-nothing, `multi` included), attempts can be capped and put on a
    // cooldown, neither the cap nor the remaining count is ever rendered, and
    // nothing is graded for a signed-out visitor. Deliberately silent on AI,
    // for the reason spelled out on `home`.
    guide: {
      lede: "New to the quiz? Here's everything you need to go from a GitHub sign-in to your first scored answer.",
      metaDescription:
        "Step-by-step guide to the quiz: sign in with GitHub, work through the questions, and get scored the moment you submit an answer.",
      loop: {
        kicker: "The loop",
        cycle: ["read the question", "pick your answer", "submit it", "it's scored on the spot"],
        note: "There are no flags to submit. Every question is graded automatically against a stored answer key the moment you answer it.",
      },
      steps: () => [
        {
          title: "Sign in with GitHub",
          body: "Use the sign-in button in the header. Your GitHub login is how the leaderboard and your profile track your progress, and nothing is graded for a signed-out visitor.",
        },
        {
          title: "Join a team, or play solo",
          body: "Scoring requires a team — answers don't count until you're on one, and the quiz page sends a teamless player to their profile first. From there: create a team, join one by code or invite link, or hit Play solo for a one-click team of one.",
        },
        {
          title: "Open the question set",
          body: "Every question the organizers have published is on the Quiz page, each one showing what it is worth. Take them in any order, at your own pace, and come back to the rest later.",
        },
        {
          title: "Answer the question",
          body: "Some questions have a single right answer; others are select-all-that-apply and only score if your whole selection matches. Read carefully before you submit: a question can be capped to a limited number of attempts, and can put you on a cooldown between tries.",
        },
        {
          title: "Get scored on submit",
          body: "Your answer is graded immediately against the answer key. A correct answer scores its full points, a wrong one scores nothing, and either way there is no manual grading and no waiting on an organizer.",
        },
      ],
      notes: [
        "Every question carries its own point value, and says what it is worth before you answer it.",
        "Organizers can cap how many times a question may be attempted and make you wait between tries. The question tells you when it is on cooldown and when you have run out of attempts.",
        "Points are credited to the GitHub account you signed in with. A question answered by several teammates counts once for the team, so a team's total can be less than its members' points added together.",
      ],
      scoring:
        "Every question is worth a fixed number of points, set by the organizers when they author it. Points are awarded the moment a correct answer is submitted, graded against a stored answer key, so nothing waits on manual review. Your live total is visible on your profile once you're signed in, and on the leaderboard alongside everyone else's.",
      cta: { href: "/quiz", label: "Take the quiz" },
    },
    rules: () => ({
      // No teams bullet: the identity rule is the platform's one sentence
      // now, and quiz had no module-specific nuance to add to it.
      teams: [],
      fairPlay: [
        "The published questions are the whole game. Do not attack the scoring pipeline, the leaderboard, or other contestants' accounts.",
        "Submit your own work. Don't publish answers for others to copy during the event.",
        "Automated or scripted answering to farm attempts will get your account rate-limited or disqualified.",
      ],
      conduct: [
        "Found a bug in a question, the scoring pipeline, or the site itself? Report it to an organizer instead of exploiting it for an unfair edge.",
      ],
      scoring: [
        "Each question is worth a fixed point value, set by the organizers. Points post the moment a correct answer is submitted.",
        "A question can be capped to a limited number of attempts and can hold you on a cooldown between tries. Once you have answered it correctly, it is done.",
      ],
    }),
    // The same questions a contestant actually asks, answered for a question
    // set instead of a patch workflow. Same discipline as the copy above:
    // every claim is checked against quiz-store.ts and quiz-board.tsx —
    // grading is exact-match against a sorted key, attempts can be capped and
    // put on a cooldown, the remaining count is never rendered, and nothing is
    // graded for a signed-out visitor. Deliberately silent on AI.
    faq: () => ({
      gettingStarted: [
        {
          q: "Do I need experience to compete?",
          a: "No. The question set spans a range of difficulty, and points scale with it. Start with whichever question looks approachable and work up.",
        },
      ],
      prep: [
        {
          q: "What do I need to bring?",
          a: "A GitHub account and something to read and click with. Everything runs in the browser, and nothing is installed or downloaded.",
        },
      ],
      playing: [
        {
          q: "How do I submit an answer?",
          a: [
            "Sign in, open the ",
            { route: { href: "/quiz", label: "Quiz" } },
            " page, pick your answer and submit it. Some questions have a single right answer; others are select-all-that-apply and only score if your whole selection matches. Grading is immediate, against a stored answer key, so there is nothing to wait for and nothing for an organizer to review.",
          ],
        },
        {
          q: "How is my progress tracked?",
          a: "Sign in with GitHub to claim your row on the live leaderboard and see how many questions you have answered, and what they were worth, on your profile. Points are credited to the account you signed in with, and nothing is graded for a signed-out visitor.",
        },
        {
          q: "Can I retry a question I got wrong?",
          a: "Sometimes. Organizers can cap how many times a question may be attempted and hold you on a cooldown between tries. The question says when it is on cooldown and when you have run out of attempts. Once you have answered one correctly, it is done.",
        },
        {
          q: "I answered correctly but didn't get points. What happened?",
          a: "Check that you were signed in when you submitted: nothing is graded for a signed-out visitor. On a select-all-that-apply question, a partly right selection scores nothing, so check whether you missed one of the correct options.",
        },
      ],
    }),
    terms: () => ({
      eligibility: [
        "You need a GitHub account. Your GitHub login is your identity for scoring, so answer from the account you sign in with. Points are credited to the account that submitted the answer and cannot be moved between accounts afterwards.",
        "Organizers and anyone who wrote or reviewed the questions may compete for fun but are not eligible for prizes.",
      ],
      scope: [
        "This event authorizes no testing of any system. The published questions are the whole game, and answering them is the whole of what you are invited to do here.",
        "Explicitly out of scope: the scoring pipeline, the leaderboard, this website, the CTF Discord, and other contestants' accounts or machines. Testing any of those is not authorized by this event, and nothing here should be read as permission to do so.",
        "Found a real security bug in this site or in the scoring pipeline? That is genuinely useful. Report it to an organizer rather than exploiting it. Doing so will not cost you anything.",
        "Automated or scripted answering, to farm attempts or to enumerate the answer key, will get your account rate-limited or disqualified.",
      ],
      submissions: [
        "You submit work by answering the published questions. Each answer is graded automatically against a stored answer key the moment you submit it.",
        "Submit your own work. Passing off another contestant's answers as yours is not allowed.",
        "Don't publish answers for others to copy while the event is running. Afterwards, write up whatever you like.",
      ],
      scoring: [
        "Each question is worth a fixed point value, set by the organizers, awarded automatically the moment a correct answer is submitted. Your best-ever result per question counts.",
        "A question can be capped to a limited number of attempts and can hold you on a cooldown between tries. Attempts are final: there is no refund and no reset.",
      ],
    }),
    routeCard: () => "Every question the organizers have published.",
  },
  classic: {
    id: "classic",
    displayName: "Classic CTF",
    description: "Find the flag, submit the string, take the points.",
    nav: { href: "/flags", label: "Flags" },
    emptyBoard: {
      line: "No flags captured yet. Every rank is unclaimed. Capture your first flag and you’ll be the one everyone else is chasing.",
      cta: { href: "/flags", label: "$ capture a flag" },
    },
    // Deliberately plain and factual, and deliberately silent on AI, for the
    // same reason quiz's copy is: secure-development invites an agent because
    // patching WITH one is the skill it teaches; on a flag hunt the same
    // invitation reads as permission to cheat.
    //
    // Deliberately says "flag" where the other modules say "challenge" or
    // "question": "challenge" is on the secure-development term list this
    // whole module family gets checked against (see secure-dev-terms.ts) —
    // secure-development's own copy uses it constantly ("pick a challenge",
    // "every challenge is worth") — so a classic-only /how-to-play, /rules,
    // /faq or /terms that used it would trip that page's own leak test. "Flag"
    // is also just the word contestants actually use for one of these.
    //
    // Every claim below is checked against the implementation, same
    // discipline as quiz's: `flagComparisonForm` (classic-keys.ts) trims and
    // NFC-normalizes both sides, and lowercases them UNLESS the challenge is
    // marked case-sensitive (issue #193; the board badges those) — so the
    // case-insensitivity claim must always carry that qualifier. Stating it
    // unconditionally shipped in v0.3.0 and contradicted the badge. There is NO attempt cap anywhere in classic-store.ts's
    // `evaluateGate`; it only ever refuses on paused/already-solved/cooldown,
    // never on a spent allowance, so never promise or imply one. There IS a
    // cooldown (`CLASSIC_COOLDOWN_SEC`, organizer-configurable in seconds via
    // `classicCooldownSec`). Every challenge carries a category and a point
    // value, and a solve count is shown (`challenge-board.tsx`'s tiles carry
    // the category heading and the "N pts" badge; `challenge-detail.tsx`'s
    // `ChallengeCard` carries the "N solve(s)" line on the challenge's own
    // page). Points are static — `SUBMIT_SCRIPT` reads the price off
    // the challenge hash at solve time and nothing anywhere lowers it as more
    // people solve. Nothing is graded for a signed-out visitor (`/flags`
    // renders a sign-in prompt instead of an input; `/api/classic/submit`
    // 401s with no session). Descriptions render through `markdown.ts`'s
    // small subset — bold, italics, inline code, lists, code blocks and
    // links — never raw HTML.
    home: {
      tagline: "Classic CTF",
      intro: () =>
        "Find each flag and submit it for points. Every flag carries its own point value, grading happens the instant you submit, and matching ignores leading or trailing whitespace and — unless a flag is marked case-sensitive on its card — capitalisation too.",
      expect: {
        heading: "Find it, submit it, get scored on the spot",
        lede: "Each flag sits under a category and is worth a fixed number of points, and the board shows how many people have already solved it. There's no cap on attempts, though organizers can set a short cooldown between tries on the same flag. Matching is exact once it's normalized: case doesn't matter, and leading or trailing whitespace is stripped before it's compared.",
      },
      steps: () => [
        {
          title: "Sign in with GitHub",
          body: "Sign in to claim your row on the leaderboard. Nothing is graded for a signed-out visitor, and signing in is what lets you leave and come back to the board later.",
        },
        {
          title: "Pick a flag and go find it",
          body: "Every flag is grouped by category and shows what it's worth and how many people have already solved it. Work in any order, at your own pace.",
        },
        {
          title: "Submit it and get scored",
          body: "Paste the flag into the box and submit. It's checked immediately: matching ignores case and leading or trailing whitespace, so a slightly different spelling still counts as long as the flag itself is right.",
        },
      ],
      cta: { href: "/flags", label: "Browse the flags" },
    },
    // The long-form guide. Same discipline as `home` above: every claim is
    // checked against classic-store.ts, challenge-board.tsx and
    // challenge-detail.tsx. No `example` or
    // `callout` block — classic has no worked example to walk (there's no
    // fixed method for finding a flag) and, like quiz, is deliberately silent
    // on AI.
    guide: {
      lede: "New to the board? Here's everything you need to go from a GitHub sign-in to your first solved flag.",
      metaDescription:
        "Step-by-step guide to the flag board: sign in with GitHub, work through the flags, and get scored the instant you submit a correct one.",
      loop: {
        kicker: "The loop",
        cycle: ["find the flag", "submit it", "it's scored on the spot"],
        note: "Every flag is checked immediately against the answer stored for it, the moment you submit.",
      },
      steps: () => [
        {
          title: "Sign in with GitHub",
          body: "Use the sign-in button in the header. Your GitHub login is how the leaderboard and your profile track your progress, and nothing is graded for a signed-out visitor.",
        },
        {
          title: "Join a team, or play solo",
          body: "Scoring requires a team — flags don't count until you're on one, and the board sends a teamless player to their profile first. From there: create a team, join one by code or invite link, or hit Play solo for a one-click team of one.",
        },
        {
          title: "Open the board",
          body: "Every flag the organizers have published is on the Flags page, grouped by category. Each one shows what it's worth and how many people have already solved it. Work in any order, at your own pace.",
        },
        {
          title: "Find the flag",
          body: "Read the description, then do whatever it takes to turn up the flag it's pointing at. There's no fixed method — some flags live in a file, others in a running app, others in the description itself.",
        },
        {
          title: "Submit it and get scored",
          body: "Paste the flag into the box and submit. It's checked instantly: matching ignores leading or trailing whitespace, and casing too — unless the flag is marked case-sensitive, which its card tells you. There's no cap on how many times you can try, though organizers can set a short cooldown between submissions on the same flag.",
        },
      ],
      notes: [
        "Every flag carries its own point value, and shows what it's worth before you submit it, plus how many people have already solved it.",
        "There's no cap on attempts. Organizers can set a short cooldown between submissions on the same flag, and the board tells you when it's still counting down.",
        "Points are credited to the GitHub account you signed in with. A flag found by several teammates counts once for the team, so a team's total can be less than its members' points added together.",
      ],
      scoring:
        "Every flag is worth a fixed number of points, set by whoever wrote it, and that value never changes as more people solve it. Points are awarded the instant a correct flag is submitted — leading or trailing whitespace is ignored, and casing is too unless the flag is marked case-sensitive — so nothing waits on manual review. Your live total is visible on your profile once you're signed in, and on the leaderboard alongside everyone else's.",
      cta: { href: "/flags", label: "Browse the flags" },
    },
    rules: () => ({
      // No teams bullet: the identity rule is the platform's one sentence
      // now, and classic had no module-specific nuance to add to it.
      teams: [],
      fairPlay: [
        "The published flags are the whole game. Do not attack the scoring pipeline, the leaderboard, or other contestants' accounts.",
        "Submit your own work. Don't publish flags or writeups for others to copy during the event.",
        "Automated or scripted submission to farm attempts will get your account rate-limited or disqualified.",
      ],
      conduct: [
        "Found a bug in a flag, the scoring pipeline, or the site itself? Report it to an organizer instead of exploiting it for an unfair edge.",
      ],
      scoring: [
        "Each flag is worth a fixed point value, set by whoever wrote it, and that value doesn't change as more people solve it.",
        "Points post the instant a correct flag is submitted. There's no cap on attempts, though a short cooldown between submissions on the same flag may apply.",
      ],
    }),
    faq: () => ({
      gettingStarted: [
        {
          q: "Do I need experience to compete?",
          a: "No. The flags span a range of difficulty, and points scale with it. Start with whichever one looks approachable and work up.",
        },
      ],
      prep: [
        {
          q: "What do I need to bring?",
          a: "A GitHub account and a laptop with whatever tools you're comfortable poking around with. There's no required software beyond what a flag itself calls for.",
        },
      ],
      playing: [
        {
          q: "How do I submit a flag?",
          a: [
            "Sign in, open the ",
            { route: { href: "/flags", label: "Flags" } },
            " page, and paste the flag into the box under the one you solved. Grading is instant and happens the moment you submit: there's nothing to wait for and nothing for an organizer to review.",
          ],
        },
        {
          q: "Does case or extra spacing matter?",
          a: "No. Matching trims leading and trailing whitespace and ignores case, so it's the exact same flag either way as long as the rest matches precisely.",
        },
        {
          q: "How is my progress tracked?",
          a: "Sign in with GitHub to claim your row on the live leaderboard and see how many flags you've solved, and what they were worth, on your profile. Points are credited to the account you signed in with, and nothing is graded for a signed-out visitor.",
        },
        {
          q: "Can I retry a flag I got wrong?",
          a: "Yes, as many times as you like — there's no cap on attempts. Organizers can put a short cooldown between submissions on the same flag; the board tells you when it's still counting down.",
        },
        {
          q: "I submitted the right flag but didn't get points. What happened?",
          a: "Check that you were signed in first: nothing is graded for a signed-out visitor. If you'd already solved that one before, resubmitting the same flag doesn't add more points — you already have them.",
        },
      ],
    }),
    terms: () => ({
      eligibility: [
        "You need a GitHub account. Your GitHub login is your identity for scoring, so submit every flag from the account you sign in with. Points are credited to that account and cannot be moved between accounts afterwards.",
        "Organizers and anyone who wrote or reviewed the flags may compete for fun but are not eligible for prizes.",
      ],
      scope: [
        "This event authorizes no testing of any system. The published flags are the whole of what you're invited to do here.",
        "Explicitly out of scope: the scoring pipeline, the leaderboard, this website, the CTF Discord, and other contestants' accounts or machines. Testing any of those is not authorized by this event, and nothing here should be read as permission to do so.",
        "Found a real security bug in this site or in the scoring pipeline? That is genuinely useful. Report it to an organizer rather than exploiting it. Doing so will not cost you anything.",
        "Automated or scripted submission, to farm attempts or to enumerate flags, will get your account rate-limited or disqualified.",
      ],
      submissions: [
        "You submit work by finding and entering the flag for each one you solve. Each submission is graded automatically against the stored answer the moment you submit it.",
        "Submit your own work. Passing off another contestant's flag as yours is not allowed.",
        "Don't publish flags or writeups for others to copy while the event is running. Afterwards, write up whatever you like.",
      ],
      scoring: [
        "Each flag is worth a fixed point value, set by whoever wrote it, awarded automatically the instant a correct submission is graded. That value doesn't change as more people solve it.",
        "There is no cap on attempts. A short cooldown between submissions on the same flag may apply, and organizers may adjust it during the event.",
      ],
    }),
    routeCard: () => "Every flag the organizers have published.",
  },
  ai: {
    id: "ai",
    displayName: "AI Challenges",
    description: "Prompt-injection and guardrail challenges hosted outside the box, scored inside it.",
    // /ai exists now (the pages PR), so the module gets its nav entry — which
    // also puts /ai in GATED_ROUTES (proxy.ts's matcher must carry it too;
    // proxy.test.ts asserts the two agree) and the 404's route directory.
    nav: { href: "/ai", label: "AI Challenges" },
    emptyBoard: {
      line: "No challenges solved yet. Every rank is unclaimed. Solve your first AI challenge and you’ll be the one everyone else is chasing.",
      cta: { href: "/ai", label: "$ open a challenge" },
    },
    // Deliberately plain and factual, same discipline as quiz's and classic's
    // copy: every claim below is checked against the implementation — this
    // block predates the admin panel and hints shipping, so it stuck to what
    // was true at the time rather than promising either. Both have since
    // shipped (admin-ai-controls.tsx; hint-store.ts's ai target) and neither
    // needed this copy to change, since it never claimed they didn't exist.
    // Specifically checked against ai-store.ts, ai-token.ts and
    // ai-launch.ts, and the /api/ai routes:
    //
    //   - Each challenge is hosted on an EXTERNAL site (`AiChallenge.urlTemplate`).
    //     Opening it from `/ai/[id]` mints a fresh, PERSONAL launch token
    //     (`mintLaunchUrl`/`buildLaunchClaims`) naming the signed-in login in
    //     `sub` — nothing else on this box mints one.
    //   - `mode` is "event", "flag" or "both" (`AI_MODES`). An event-mode
    //     challenge reports its own solve back automatically, asserted by the
    //     external side against `/api/ai/event` (HMAC-signed, keyed by a
    //     per-challenge key the box alone issues); a flag/both challenge also
    //     takes a typed flag on the challenge page, graded instantly by
    //     `submitAiFlag` against a stored answer.
    //   - The launch token IS the identity carried onto the external site
    //     (`AiTokenClaims.sub`), and `/api/ai/submit` and `/api/ai/event` both
    //     act on `claims.sub` alone — cookie-blind, by design. Whoever holds a
    //     copy of the link plays and is rate-limited/cooled-down AS that login;
    //     there is no second check that the browser holding it is the one it
    //     was minted for. So: it is personal, sharing it lets someone else
    //     submit as you or spend your cooldown, and every point it earns still
    //     lands on your account regardless of who used it.
    //   - Solve timestamps are stamped by `runAward` by the box's own
    //     `new Date()` at award time — never a time the external side reports
    //     — so the box's clock decides when a solve happened, not the
    //     challenge's.
    //   - There is NO attempt cap in `evaluateGate`/`AWARD_SCRIPT`: it refuses
    //     only on paused/already-solved/cooldown, same as classic. There IS a
    //     cooldown (`AI_COOLDOWN_SEC`), applied to the GRADED path only — a
    //     signed event has no wrong answer to rate-limit (`awardAiEvent` passes
    //     cooldown 0). Hints and the admin control panel have since shipped
    //     (`admin-ai-controls.tsx`, `hint-store.ts`'s `ai` target) — nothing
    //     in this copy claims otherwise, so nothing here needed to change for
    //     that; this note just retires the "not yet" framing now that both are
    //     real.
    home: {
      tagline: "AI Challenges",
      intro: () =>
        "Each challenge is hosted on an external site. Open it from its page for a personal launch link, play it there, and a correct solve reports back to the leaderboard on its own — or, where a challenge also takes one, grade yourself by typing the flag on the page.",
      expect: {
        heading: "Play it externally, get scored automatically",
        lede: "Each challenge sits under a category and is worth a fixed number of points, and the board shows how many people have already solved it. Opening a challenge mints you a personal link into the external site; some challenges report a solve back the moment you clear them, others also take a typed flag, graded the instant you submit it.",
      },
      steps: () => [
        {
          title: "Sign in with GitHub",
          body: "Sign in to claim your row on the leaderboard. Nothing is graded for a signed-out visitor, and signing in is what lets you leave and come back to a challenge later.",
        },
        {
          title: "Open a challenge and get your link",
          body: "Every challenge is grouped by category and shows what it's worth. Opening one from its page mints you a personal launch link into the external site — that link is how it knows who you are, so it's yours alone.",
        },
        {
          title: "Play it, submit if it asks",
          body: "Work the challenge on the external site. A solve reports back to the leaderboard on its own, or, where the challenge also takes one, paste the flag into the box on its page and it's graded the instant you submit.",
        },
      ],
      cta: { href: "/ai", label: "Browse the challenges" },
    },
    guide: {
      lede: "New to the board? Here's everything you need to go from a GitHub sign-in to your first solved challenge.",
      metaDescription:
        "Step-by-step guide to the ai challenges: sign in with GitHub, open a challenge for your personal link, and get scored the moment it reports back or you submit a flag.",
      loop: {
        kicker: "The loop",
        cycle: ["open the challenge", "play it externally", "it reports back, or you submit the flag"],
        note: "Every solve is checked the moment it lands — automatically when the external site reports it, or instantly against the stored flag when you submit one yourself. Either way, the box's own clock decides when it happened.",
      },
      steps: () => [
        {
          title: "Sign in with GitHub",
          body: "Use the sign-in button in the header. Your GitHub login is how the leaderboard and your profile track your progress, and it's also the identity your personal launch link carries onto the external site.",
        },
        {
          title: "Join a team, or play solo",
          body: "Scoring requires a team — a challenge doesn't count until you're on one, and the board sends a teamless player to their profile first. From there: create a team, join one by code or invite link, or hit Play solo for a one-click team of one.",
        },
        {
          title: "Open the board",
          body: "Every challenge the organizers have published is on the AI page, grouped by category. Each one shows what it's worth and how many people have already solved it. Work in any order, at your own pace.",
        },
        {
          title: "Open a challenge for your personal link",
          body: "Opening a challenge from its page mints a launch link that signs you straight into the external site as you. It's yours alone — anyone who has it plays under your name, cooldown included — and if it ever goes stale, reopening the page mints a fresh one.",
        },
        {
          title: "Play it, and let it report back or submit the flag",
          body: "Play the challenge on the external site. Most report a solve back on their own the instant you clear them; where a challenge also takes a typed flag, paste it into the box on its page and it's graded immediately. Either way, the box's own clock decides when you solved it.",
        },
      ],
      notes: [
        "Every challenge carries its own point value, and shows what it's worth before you open it, plus how many people have already solved it.",
        "Your launch link is personal. Reopening the challenge page mints a fresh one, but don't hand yours to someone else: whatever they do with it happens under your name, cooldown included, and every point it earns still lands on your account.",
        "Points are credited to the GitHub account your launch link named. A challenge solved by several teammates counts once for the team, so a team's total can be less than its members' points added together.",
      ],
      scoring:
        "Every challenge is worth a fixed number of points, set by whoever wrote it. Points are awarded the moment your solve is recorded — automatically when the external site reports it, or instantly when a typed flag matches — so nothing waits on manual review. Your live total is visible on your profile once you're signed in, and on the leaderboard alongside everyone else's.",
      cta: { href: "/ai", label: "Browse the challenges" },
    },
    rules: () => ({
      // No teams bullet: the identity rule is the platform's one sentence
      // now, and the link-sharing nuance belongs to fair play, not team
      // crediting.
      teams: [],
      fairPlay: [
        "The published challenges are the whole game. Do not attack the scoring pipeline, the leaderboard, or other contestants' accounts.",
        "Your launch link is personal. Do not share it: anyone holding it can play or submit as you, cooldown included, and every point it earns still lands on your account regardless of who used it.",
        "Automated or scripted play to farm attempts will get your account rate-limited or disqualified.",
      ],
      conduct: [
        "Found a bug in a challenge, the scoring pipeline, or the site itself? Report it to an organizer instead of exploiting it for an unfair edge.",
      ],
      scoring: [
        "Each challenge is worth a fixed point value, set by whoever wrote it. Points post the moment your solve is recorded, whether the external site reported it or you submitted a matching flag.",
        "The box's own clock decides when a solve happened, not the external site's.",
      ],
    }),
    faq: () => ({
      gettingStarted: [
        {
          q: "Do I need experience to compete?",
          a: "No. The challenges span a range of difficulty, and points scale with it. Start with whichever one looks approachable and work up.",
        },
        {
          q: "Do I need my own AI account?",
          a: "Depends on the event's challenges — some external sites ask you to sign in with something of your own, others don't. Check the challenge page, or ask an organizer if a specific one isn't clear.",
        },
      ],
      prep: [
        {
          q: "What do I need to bring?",
          a: "A GitHub account and a laptop. Everything else runs on the external site each challenge links to.",
        },
      ],
      playing: [
        {
          q: "How do I play a challenge?",
          a: [
            "Sign in, open the ",
            { route: { href: "/ai", label: "AI Challenges" } },
            " page, and open the one you want. That mints you a personal launch link into the external site — follow it and play there. A solve reports back on its own, or, where the challenge also takes one, paste the flag into the box on its page.",
          ],
        },
        {
          q: "How is my progress tracked?",
          a: "Sign in with GitHub to claim your row on the live leaderboard and see how many challenges you've solved, and what they were worth, on your profile. Points are credited to the account your launch link named, and nothing is graded for a signed-out visitor.",
        },
        {
          q: "I solved it on the site but see no points. What happened?",
          a: "Reopen the challenge page for a fresh link and check the leaderboard — sometimes a solve just hasn't landed yet. Still nothing after that? Ask an organizer.",
        },
        {
          q: "Can I retry a challenge I haven't solved?",
          a: "Yes. There's no cap on attempts, though a short, fixed cooldown sits between wrong tries on the same challenge; reopening the challenge page always gets you a fresh launch link.",
        },
      ],
    }),
    terms: () => ({
      eligibility: [
        "You need a GitHub account. Your GitHub login is your identity for scoring — it's also what your personal launch link carries onto the external site — and points are credited to that account and cannot be moved between accounts afterwards.",
        "Organizers and anyone who wrote or reviewed the challenges may compete for fun but are not eligible for prizes.",
      ],
      scope: [
        "This event authorizes no testing of any system. The published challenges are the whole of what you're invited to do here, on whichever external site each one names.",
        "Explicitly out of scope: the scoring pipeline, the leaderboard, this website, the CTF Discord, and other contestants' accounts or launch links. Testing any of those is not authorized by this event, and nothing here should be read as permission to do so.",
        "Found a real security bug in this site or in the scoring pipeline? That is genuinely useful. Report it to an organizer rather than exploiting it. Doing so will not cost you anything.",
        "Automated or scripted play, to farm attempts or to enumerate flags, will get your account rate-limited or disqualified.",
      ],
      submissions: [
        "Playing an external challenge sends your GitHub login and your progress on this module to that challenge's operator — that is what your personal launch link carries, and it's how the site knows you and can report your solve back.",
        "Submit your own work. Passing off another contestant's solve as yours is not allowed, and neither is playing under someone else's launch link.",
        "Don't publish flags or writeups for others to copy while the event is running. Afterwards, write up whatever you like.",
      ],
      scoring: [
        "Each challenge is worth a fixed point value, set by whoever wrote it, awarded automatically when your solve is recorded — whether the external site reported it or you submitted a matching flag. Your best-ever result per challenge counts.",
        "There is no cap on attempts. A short, fixed cooldown applies between wrong submissions on the same challenge.",
      ],
    }),
    routeCard: () => "Every AI challenge the organizers have published.",
  },
};

/** A full `ModuleDef` for EVERY registered module, whether or not this event's
 *  `event.yaml` names it.
 *
 *  Exists for runtime enablement (issue #175): a module switched on from
 *  /admin was, by definition, not in the baked config, so there is no
 *  `eventConfig.modules` entry to build its def from. Its registry entry plus
 *  an empty target list is that def.
 *
 *  `targets` still comes from `event.yaml` where the organizer supplied it,
 *  and only secure-development has any — which is the same reason that module
 *  is NOT runtime-toggleable: a target list is provisioning input for
 *  `ctf-setup.sh` (forks, the App install, per-fork workflows), not a flag the
 *  web tier can conjure. See the ADR. */
const MODULE_DEFS: Record<ModuleId, ModuleDef> = Object.fromEntries(
  (Object.keys(REGISTRY) as ModuleId[]).map((id) => [
    id,
    {
      ...REGISTRY[id],
      targets: id === "secure-development" ? (eventConfig.modules.find((c) => c.id === id)?.targets ?? []) : [],
    },
  ]),
) as Record<ModuleId, ModuleDef>;

export const enabledModules: readonly ModuleDef[] = eventConfig.modules.map((cfg) => MODULE_DEFS[cfg.id]);

export function isModuleEnabled(id: ModuleId): boolean {
  return enabledModules.some((m) => m.id === id);
}

// There is deliberately no "enabled modules' routes" list here. One existed
// (`enabledModuleRoutes`) for the pre-event gate, but the gate stopped using
// it when enablement became a runtime setting (#175, commit 2201188):
// proxy.ts gates ALL_MODULE_ROUTES below — the superset, needing no Redis
// read from middleware — and /gate computes its own destination from the
// live resolved list. With no caller left, the list came out rather than
// stay as a second, baked-only answer to "which routes are live" that could
// drift from the runtime one.

/** EVERY route the registry knows about, enabled or not.
 *
 *  Exists because Next requires the proxy's `matcher` to be a static literal
 *  ("matcher values need to be constants so they can be statically analyzed at
 *  build-time. Dynamic values such as variables will be ignored" — the
 *  vendored proxy docs), so that list CANNOT be computed from this one. It is
 *  written out by hand there and asserted against this by proxy.test.ts, so
 *  registering a module with a route the proxy never sees fails a test instead
 *  of silently un-gating the new route. */
export const ALL_MODULE_ROUTES: readonly string[] = (
  Object.values(REGISTRY) as Omit<ModuleDef, "targets">[]
).flatMap((m) => (m.nav ? [m.nav.href] : []));

/** Every module id the registry knows about, enabled or not — the vocabulary
 *  a runtime enablement set is validated against (issue #175). Derived from
 *  REGISTRY rather than restated, so registering a module cannot forget it. */
export const ALL_MODULE_IDS: readonly ModuleId[] = Object.keys(REGISTRY) as ModuleId[];

/** A registered module's def by id, enabled or not.
 *
 *  The registry accessors in `resolved-modules.ts` (`getModuleHome` and
 *  friends) go through this rather than searching `enabledModules`. Searching
 *  the BAKED list meant a module enabled at runtime resolved to `undefined`
 *  for every one of them — it would get a route, a nav link and a tab, and
 *  then render with no landing section, no how-to-play steps, no rules, no FAQ
 *  and no terms. Enablement is the caller's question (they already iterate the
 *  resolved list); this answers "what does the registry say about this id". */
export function moduleDefById(id: ModuleId): ModuleDef | undefined {
  return MODULE_DEFS[id];
}

/** Narrows an arbitrary string to a registered module id. Used on the way IN
 *  from Redis: an id that is not in the registry has no route, no nav entry
 *  and no tab, so honouring one would enable something that cannot render. */
export function isModuleId(value: unknown): value is ModuleId {
  return typeof value === "string" && (ALL_MODULE_IDS as readonly string[]).includes(value);
}

/** The ids `event.yaml` baked in — the fallback whenever the runtime set is
 *  absent or unreadable. Deliberately NOT the source of truth once #175's
 *  admin control exists: `event.yaml` seeds an event and catches a Redis
 *  outage, and the live set is what the box actually serves. */
export const bakedModuleIds: readonly ModuleId[] = enabledModules.map((m) => m.id);

/** Organizer-authored, runtime overrides keyed by module id. Both fields are
 *  optional and an empty string means "no override" — see resolveModules. */
export type ModuleOverrides = Partial<Record<ModuleId, { title?: string; blurb?: string }>>;

/** Caps for organizer-authored per-module naming overrides (title/blurb).
 *  Defined here — not in `admin-store.ts`, which validates against them —
 *  because this module is client-safe and `admin-store.ts` is `server-only`;
 *  the admin panel's identity form (a Client Component) needs these numbers
 *  for its `maxLength` attributes and would break the client build if it
 *  imported them (or anything else) from admin-store by value. admin-store
 *  re-exports these two so it stays the single place server code looks for
 *  them. */
export const MODULE_TITLE_MAX = 60;
export const MODULE_BLURB_MAX = 200;

/** A module with its organizer-authored naming applied: identity only, and
 *  deliberately client-safe.
 *
 *  `displayName`/`description` are OMITTED rather than carried through: they
 *  are the registry DEFAULTS, and `title`/`blurb` are what a consumer must
 *  render. Keeping both on the same object made reading `.displayName` off a
 *  resolved module — silently ignoring the organizer's override — a plain
 *  property access with no type error. Dropping them turns that mistake into
 *  a compile failure.
 *
 *  The copy blocks — `home`, `guide`, `rules`, `faq`, `terms` and `routeCard`
 *  — are OMITTED for a harder reason: `ModuleHome.intro`, `ModuleHome.steps`,
 *  `ModuleGuide.steps`, `ModuleGuide.example`, `routeCard`, and
 *  `ModuleRules`/`ModuleFaq`/`ModuleTerms` themselves
 *  are FUNCTIONS, and resolved modules are handed straight
 *  from Server Components to `"use client"` components (the admin panel, the
 *  leaderboard). React's flight serializer throws "Functions cannot be passed
 *  directly to Client Components" on any function-valued prop, so a resolved
 *  module carrying `home` would 500 those pages the moment a module defines
 *  one. Keeping identity-only here makes that structurally impossible instead
 *  of a trap for the next module to opt into landing-page copy. Server code
 *  that needs the home block reads it from the registry — see
 *  `getModuleHome` in `@/lib/resolved-modules`. */
export type ResolvedModule = Omit<
  ModuleDef,
  "displayName" | "description" | "home" | "guide" | "rules" | "faq" | "terms" | "routeCard"
> & {
  /** What to render wherever the MODULE names itself: the organizer's
   *  override, or the registry `displayName`. Never empty. */
  title: string;
  blurb: string;
  /** The organizer's override alone — trimmed, or `undefined` when unset.
   *
   *  This exists because `title` cannot answer "did the organizer rename
   *  this?", and some surfaces have a per-surface default that is
   *  deliberately NOT the module's name. `secure-development`'s nav label is
   *  "Challenges" while its display name is "Secure Development": one names
   *  the module, the other describes the destination page. Rendering `title`
   *  there silently renamed the nav on every existing event with no override
   *  involved. The rule is: an explicit override replaces the module's name
   *  wherever it appears; with no override, the existing per-surface default
   *  stands unchanged. Surfaces with their own default read
   *  `titleOverride || <that default>`; surfaces that always showed the
   *  module's name keep reading `title`.
   *
   *  A string (or absent), so this stays safe to hand to a Client Component
   *  — see the note above about `home`. */
  titleOverride?: string;
};

/** The module defs this event is serving, in the order they should render.
 *
 *  Ordering rule, and it is deliberate: **the baked order first**, filtered to
 *  what is live, then anything enabled at runtime that `event.yaml` never
 *  mentioned, in registry order. An organizer who listed their modules in a
 *  particular order in `event.yaml` gets that order in the nav, exactly as
 *  before — toggling a module off and back on must not silently reshuffle the
 *  header. A runtime set has no order of its own, so newly-enabled modules
 *  have to fall back to the registry's, and appending them keeps the change
 *  additive rather than a reshuffle. */
function moduleDefsFor(enabled: ReadonlySet<ModuleId>): readonly ModuleDef[] {
  const baked = enabledModules.filter((m) => enabled.has(m.id));
  const bakedIds = new Set(baked.map((m) => m.id));
  const added = ALL_MODULE_IDS.filter((id) => enabled.has(id) && !bakedIds.has(id)).map((id) => MODULE_DEFS[id]);
  return [...baked, ...added];
}

/** Merge registry defaults with organizer overrides. Pure — no I/O — so it is
 *  testable on its own and usable either side of the server boundary. An
 *  override for a module that isn't enabled has nothing to apply to and is
 *  simply absent from the result; an empty string is treated as unset so
 *  clearing a field in the admin UI restores the registry default.
 *
 *  `enabled` is the LIVE module set (issue #175). Omitting it means "use the
 *  baked set", which is what every pure/client-side caller and every test
 *  written before runtime enablement does — so this stays a drop-in. */
export function resolveModules(
  overrides: ModuleOverrides,
  enabled?: ReadonlySet<ModuleId>,
): readonly ResolvedModule[] {
  const defs = enabled ? moduleDefsFor(enabled) : enabledModules;
  // Destructure the defaults OUT rather than spreading them through, so a
  // resolved module genuinely has no `displayName` to read by mistake — the
  // type and the runtime object agree. Every copy block — `home`, `guide`,
  // `rules`, `faq`, `terms`, `routeCard` — goes the same way, and there it
  // is load-bearing rather than merely tidy: a type-level Omit alone would
  // leave the functions on the object, still crossing the RSC boundary and
  // still throwing. Stripping them here is what makes the result client-safe.
  // They are bound only to keep them out of `...rest` — being unused IS the
  // point, so the lint warning is silenced deliberately rather than worked
  // around by re-spreading and deleting.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return defs.map(({ displayName, description, home, guide, rules, faq, terms, routeCard, ...rest }) => {
    const o = overrides[rest.id];
    // Computed once and carried through as `titleOverride`, so a consumer
    // with its own per-surface default (the nav label, /challenges' page
    // title) can tell "the organizer renamed this" from "the registry
    // default happens to be this string" — see ResolvedModule.
    const titleOverride = o?.title?.trim() || undefined;
    return {
      ...rest,
      titleOverride,
      title: titleOverride ?? displayName,
      blurb: o?.blurb?.trim() || description,
    };
  });
}
