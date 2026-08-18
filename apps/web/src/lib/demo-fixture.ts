// Bundled demo dataset for the DEMO_MODE 'Seed demo data' admin action.
// Challenge ids are real lowercased catalogue keys so the scorer awards points
// (foreign ids are skipped by buildLeaderboard). Regenerate if those keys change.
// NOT loaded in production paths — the seed route is DEMO_MODE + admin gated.

export type DemoContestant = { login: string; solves: Record<string, string[]> };
export type DemoTeam = { slug: string; name: string; captain: string; members: string[] };

// Quiz demo data (DEMO_MODE 'Seed demo data', quiz module only). Mirrors the
// shape quiz-store.ts's `Question`/correct-answer-key expects: `correct` is
// NOT part of the public `Question` shape written to `ctf:quiz:questions` —
// it is used only to derive `ctf:quiz:key`'s sorted, deduped array (the same
// recipe `upsertQuestion` applies) and each demo answer's banked `choices`.
export type DemoChoice = { id: string; label: string };
export type DemoQuestionType = "single" | "multi";
export type DemoQuestion = {
  id: string;
  prompt: string;
  type: DemoQuestionType;
  choices: DemoChoice[];
  points: number;
  order: number;
  /** Correct choice id(s) — one for `"single"`, two or more for `"multi"`. */
  correct: string[];
};

export const DEMO_QUESTIONS: DemoQuestion[] = [
  {
    id: "xss-basics",
    prompt: "What does XSS stand for?",
    type: "single",
    order: 1,
    points: 50,
    choices: [
      { id: "a", label: "Cross-Site Scripting" },
      { id: "b", label: "XML Signature Exchange" },
      { id: "c", label: "Cross-Server Xchange" },
      { id: "d", label: "Extended Session Storage" },
    ],
    correct: ["a"],
  },
  {
    id: "injection-types",
    prompt: "Which of these are injection vulnerabilities? (choose all that apply)",
    type: "multi",
    order: 2,
    points: 100,
    choices: [
      { id: "a", label: "SQL Injection" },
      { id: "b", label: "Command Injection" },
      { id: "c", label: "Cross-Site Scripting" },
      { id: "d", label: "Broken Access Control" },
    ],
    correct: ["a", "b"],
  },
  {
    id: "owasp-top10-2021",
    prompt: "Which OWASP Top 10 (2021) category covers broken access control?",
    type: "single",
    order: 3,
    points: 50,
    choices: [
      { id: "a", label: "A01:2021" },
      { id: "b", label: "A03:2021" },
      { id: "c", label: "A05:2021" },
      { id: "d", label: "A07:2021" },
    ],
    correct: ["a"],
  },
  {
    id: "secure-headers",
    prompt: "Which HTTP response headers help mitigate common web attacks? (choose all that apply)",
    type: "multi",
    order: 4,
    points: 100,
    choices: [
      { id: "a", label: "Content-Security-Policy" },
      { id: "b", label: "X-Frame-Options" },
      { id: "c", label: "Set-Cookie" },
      { id: "d", label: "Strict-Transport-Security" },
    ],
    correct: ["a", "b", "d"],
  },
  {
    id: "csrf-defense",
    prompt: "What is the primary defense against CSRF attacks?",
    type: "single",
    order: 5,
    points: 75,
    choices: [
      { id: "a", label: "Anti-CSRF tokens" },
      { id: "b", label: "Rate limiting" },
      { id: "c", label: "Password hashing" },
      { id: "d", label: "CORS headers" },
    ],
    correct: ["a"],
  },
];

export type DemoQuizAnswer = { login: string; questionId: string };

// Spread across every demo contestant (not just the top solver) so DEMO_MODE
// shows a genuinely combined leaderboard — patching points AND quiz points
// both moving the same board.
export const DEMO_QUIZ_ANSWERS: DemoQuizAnswer[] = [
  { login: "neo-anderson", questionId: "xss-basics" },
  { login: "neo-anderson", questionId: "injection-types" },
  { login: "neo-anderson", questionId: "csrf-defense" },
  { login: "trinity-h", questionId: "xss-basics" },
  { login: "trinity-h", questionId: "owasp-top10-2021" },
  { login: "kevin-mitnick", questionId: "injection-types" },
  { login: "kevin-mitnick", questionId: "secure-headers" },
  { login: "grace-hopper", questionId: "xss-basics" },
  { login: "grace-hopper", questionId: "secure-headers" },
  { login: "grace-hopper", questionId: "csrf-defense" },
  { login: "ada-lovelace", questionId: "owasp-top10-2021" },
  { login: "morpheus-z", questionId: "injection-types" },
];

export const DEMO_CONTESTANTS: DemoContestant[] = [
  {
    "login": "neo-anderson",
    "solves": {
      "juice-shop": [
        "challenge-12-security-through-obscurity",
        "challenge-59-outdated-allowlist",
        "challenge-1-password-hash-leak",
        "challenge-16-nautical-mystery",
        "challenge-45-login-admin",
        "challenge-5-admin-section",
        "challenge-66-reflected-xss",
        "challenge-10-mint-the-honey-pot"
      ],
      "dvwa": [
        "challenge-1-brute-force-low",
        "challenge-2-command-injection-low",
        "challenge-3-csrf-low",
        "challenge-4-file-inclusion-low",
        "challenge-5-file-upload-low",
        "challenge-6-insecure-captcha-low",
        "challenge-7-sql-injection-low",
        "challenge-8-sql-injection-blind-low",
        "challenge-9-weak-session-ids-low",
        "challenge-10-xss-dom-low"
      ],
      "vampi": [
        "challenge-1-excessive-data-exposure",
        "challenge-2-user-and-pass-enumeration",
        "challenge-3-sqli",
        "challenge-4-mass-assignment",
        "challenge-5-bola",
        "challenge-6-unauthorized-password-change",
        "challenge-7-weak-jwt",
        "challenge-8-regex-dos",
        "challenge-9-no-rate-limit"
      ],
      "webgoat": [
        "challenge-15-authorization-bypass",
        "challenge-10-field-restriction-bypass",
        "challenge-11-frontend-validation-bypass",
        "challenge-40-csrf-flag",
        "challenge-39-csrf-feedback",
        "challenge-37-csrf-login"
      ]
    }
  },
  {
    "login": "trinity-h",
    "solves": {
      "juice-shop": [
        "challenge-12-security-through-obscurity",
        "challenge-59-outdated-allowlist",
        "challenge-1-password-hash-leak",
        "challenge-16-nautical-mystery",
        "challenge-45-login-admin",
        "challenge-5-admin-section"
      ],
      "vulnerableapp": [
        "challenge-1-authentication-level-1",
        "challenge-2-authentication-level-2",
        "challenge-3-authentication-level-3",
        "challenge-4-authentication-level-7",
        "challenge-5-authentication-level-8",
        "challenge-6-authentication-level-10",
        "challenge-7-blind-sqli-level-1",
        "challenge-8-blind-sqli-level-2",
        "challenge-9-cache-poisoning-level-1",
        "challenge-10-cache-poisoning-level-2",
        "challenge-11-cache-poisoning-level-3",
        "challenge-12-cache-poisoning-level-4"
      ],
      "securityshepherd": [
        "challenge-1-broken-crypto-3",
        "challenge-2-broken-crypto-4",
        "challenge-3-csrf-1",
        "challenge-4-csrf-2",
        "challenge-5-csrf-3"
      ]
    }
  },
  {
    "login": "kevin-mitnick",
    "solves": {
      "dvwa": [
        "challenge-1-brute-force-low",
        "challenge-2-command-injection-low",
        "challenge-3-csrf-low",
        "challenge-4-file-inclusion-low",
        "challenge-5-file-upload-low",
        "challenge-6-insecure-captcha-low",
        "challenge-7-sql-injection-low",
        "challenge-8-sql-injection-blind-low",
        "challenge-9-weak-session-ids-low"
      ],
      "webgoat": [
        "challenge-15-authorization-bypass",
        "challenge-10-field-restriction-bypass",
        "challenge-11-frontend-validation-bypass",
        "challenge-40-csrf-flag",
        "challenge-39-csrf-feedback",
        "challenge-37-csrf-login",
        "challenge-38-csrf-review",
        "challenge-78-xss-stego-challenge"
      ],
      "securityshepherd": [
        "challenge-1-broken-crypto-3",
        "challenge-2-broken-crypto-4",
        "challenge-3-csrf-1",
        "challenge-4-csrf-2",
        "challenge-5-csrf-3",
        "challenge-6-csrf-4"
      ]
    }
  },
  {
    "login": "grace-hopper",
    "solves": {
      "juice-shop": [
        "challenge-12-security-through-obscurity",
        "challenge-59-outdated-allowlist",
        "challenge-1-password-hash-leak",
        "challenge-16-nautical-mystery",
        "challenge-45-login-admin"
      ],
      "webgoat": [
        "challenge-15-authorization-bypass",
        "challenge-10-field-restriction-bypass",
        "challenge-11-frontend-validation-bypass",
        "challenge-40-csrf-flag",
        "challenge-39-csrf-feedback",
        "challenge-37-csrf-login",
        "challenge-38-csrf-review",
        "challenge-78-xss-stego-challenge",
        "challenge-79-sql-injection-challenge",
        "challenge-80-password-reset-git-challenge"
      ],
      "vampi": [
        "challenge-1-excessive-data-exposure",
        "challenge-2-user-and-pass-enumeration",
        "challenge-3-sqli",
        "challenge-4-mass-assignment",
        "challenge-5-bola",
        "challenge-6-unauthorized-password-change"
      ]
    }
  },
  {
    "login": "ada-lovelace",
    "solves": {
      "vulnerableapp": [
        "challenge-1-authentication-level-1",
        "challenge-2-authentication-level-2",
        "challenge-3-authentication-level-3",
        "challenge-4-authentication-level-7",
        "challenge-5-authentication-level-8",
        "challenge-6-authentication-level-10",
        "challenge-7-blind-sqli-level-1",
        "challenge-8-blind-sqli-level-2",
        "challenge-9-cache-poisoning-level-1",
        "challenge-10-cache-poisoning-level-2",
        "challenge-11-cache-poisoning-level-3"
      ],
      "dvwa": [
        "challenge-1-brute-force-low",
        "challenge-2-command-injection-low",
        "challenge-3-csrf-low",
        "challenge-4-file-inclusion-low",
        "challenge-5-file-upload-low",
        "challenge-6-insecure-captcha-low"
      ]
    }
  },
  {
    "login": "morpheus-z",
    "solves": {
      "juice-shop": [
        "challenge-12-security-through-obscurity",
        "challenge-59-outdated-allowlist",
        "challenge-1-password-hash-leak",
        "challenge-16-nautical-mystery"
      ],
      "vulnerableapp": [
        "challenge-1-authentication-level-1",
        "challenge-2-authentication-level-2",
        "challenge-3-authentication-level-3",
        "challenge-4-authentication-level-7",
        "challenge-5-authentication-level-8",
        "challenge-6-authentication-level-10",
        "challenge-7-blind-sqli-level-1"
      ]
    }
  }
];

export const DEMO_TEAMS: DemoTeam[] = [
  {
    "slug": "zero-cool",
    "name": "Zero Cool",
    "captain": "neo-anderson",
    "members": [
      "neo-anderson",
      "trinity-h"
    ]
  },
  {
    "slug": "the-plague",
    "name": "The Plague",
    "captain": "kevin-mitnick",
    "members": [
      "kevin-mitnick",
      "morpheus-z"
    ]
  },
  {
    "slug": "byte-me",
    "name": "Byte Me",
    "captain": "grace-hopper",
    "members": [
      "grace-hopper",
      "ada-lovelace"
    ]
  }
];
