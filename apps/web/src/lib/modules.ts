// CTF module registry. Registration is deliberate: a new vertical is code
// (an entry here) + config (a key under modules. in event.yaml) — never
// config alone. See the kit's docs/modules.md for the full contract.
import type { AppId } from "@/lib/apps";
import { eventConfig } from "@/lib/event-config";

export type ModuleId = "secure-development" | "quiz";

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
  | { link: { href: string; label: string } };

/** Either a plain sentence or a segmented one — see `CopySegment`. */
export type Copy = string | CopySegment[];

/** Live facts handed to a module's `/rules` copy. Same idea as `HomeContext`,
 *  minus the landing page's catalogue-derived numbers, which `/rules` has no
 *  reason to fetch. */
export type RulesContext = {
  appCount: number;
  appList: string;
};

/** Live facts handed to a module's `/how-to-play` copy: the rules context
 *  plus the org contestants push to and which worked-example variant applies
 *  (see `workedExampleVariant` in `@/lib/apps`). Passed IN rather than
 *  imported by the registry so a module's copy stays a pure function of its
 *  context. */
export type GuideContext = RulesContext & {
  githubOrg: string;
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
        `Break real vulnerabilities in ${ctx.appCount} OWASP training ${ctx.appCount === 1 ? "app" : "apps"}, patch them for real, and ship the fix as a GitHub pull request. CI validates your patch and scores it automatically. Practice the full secure development lifecycle, not just flag-hunting.`,
      expect: {
        heading: "This isn’t flag hunting. It’s the real fix workflow",
        lede: "Every challenge maps to a real, disclosed vulnerability class from the OWASP Top 10. You find it, patch it, and prove the fix with a passing regression test, the same loop a security engineer runs against a live codebase.",
      },
      steps: (ctx) => [
        {
          title: "Pick a target",
          body: `Choose from ${ctx.appCount} real, deliberately vulnerable OWASP ${ctx.appCount === 1 ? "app" : "apps"}: ${ctx.appList}.`,
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
        "Points are credited to the GitHub account that authored the PR. Team totals are the sum of what each member lands individually.",
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
      teams: [
        "Your GitHub login is your identity for scoring. Submit every pull request from the account you signed in with.",
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
        "Points are credited to the GitHub account you signed in with. Team totals are the sum of what each member scores individually.",
      ],
      scoring:
        "Every question is worth a fixed number of points, set by the organizers when they author it. Points are awarded the moment a correct answer is submitted, graded against a stored answer key, so nothing waits on manual review. Your live total is visible on your profile once you're signed in, and on the leaderboard alongside everyone else's.",
      cta: { href: "/quiz", label: "Take the quiz" },
    },
    rules: () => ({
      teams: [
        "Your GitHub login is your identity for scoring. Answer from the account you signed in with.",
      ],
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
  },
};

export const enabledModules: readonly ModuleDef[] = eventConfig.modules.map((cfg) => ({
  ...REGISTRY[cfg.id],
  targets: cfg.id === "secure-development" ? cfg.targets : [],
}));

export function isModuleEnabled(id: ModuleId): boolean {
  return enabledModules.some((m) => m.id === id);
}

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
 *  The copy blocks — `home`, `guide` and `rules` — are OMITTED for a harder
 *  reason: `ModuleHome.intro`, `ModuleHome.steps`, `ModuleGuide.steps`,
 *  `ModuleGuide.example` and `ModuleRules` itself
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
  "displayName" | "description" | "home" | "guide" | "rules"
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

/** Merge registry defaults with organizer overrides. Pure — no I/O — so it is
 *  testable on its own and usable either side of the server boundary. An
 *  override for a module that isn't enabled has nothing to apply to and is
 *  simply absent from the result; an empty string is treated as unset so
 *  clearing a field in the admin UI restores the registry default. */
export function resolveModules(overrides: ModuleOverrides): readonly ResolvedModule[] {
  // Destructure the defaults OUT rather than spreading them through, so a
  // resolved module genuinely has no `displayName` to read by mistake — the
  // type and the runtime object agree. The three copy blocks — `home`,
  // `guide` and `rules` — go the same way, and there it
  // is load-bearing rather than merely tidy: a type-level Omit alone would
  // leave the functions on the object, still crossing the RSC boundary and
  // still throwing. Stripping them here is what makes the result client-safe.
  // They are bound only to keep them out of `...rest` — being unused IS the
  // point, so the lint warning is silenced deliberately rather than worked
  // around by re-spreading and deleting.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return enabledModules.map(({ displayName, description, home, guide, rules, ...rest }) => {
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
