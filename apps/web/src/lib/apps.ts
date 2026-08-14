// The six vulnerable-app targets contestants patch. challengeCount/maxPoints/
// stars are a static FALLBACK — the challenges page prefers the live counts
// from `${LEADERBOARD_API_URL}/challenges` (see lib/challenges.ts) and only
// shows these when that fetch fails.

export type AppId =
  | "juice-shop"
  | "dvwa"
  | "webgoat"
  | "securityshepherd"
  | "vulnerableapp"
  | "vampi";

export type AppMeta = {
  id: AppId;
  name: string;
  blurb: string;
  /** Accent token used for chips, rings, and hover glows. */
  accent: string;
  /** Single-path SVG (24x24, stroke) rendered in the app chip. */
  icon: string;
  /** The event fork players exploit and patch (public at event start). */
  repo: string;
  challengeCount: number;
  maxPoints: number;
  /** Difficulty range in stars (points per challenge). */
  stars: [min: number, max: number];
};

export const apps: AppMeta[] = [
  {
    id: "juice-shop",
    name: "Juice Shop",
    blurb: "The classic deliberately-insecure web shop. OWASP Web Top 10.",
    accent: "#d4a017",
    icon: "M8 2h8l-1 7H9L8 2ZM9 9h6l1 13H8L9 9Z",
    repo: "https://github.com/OWASP-CTF/juice-shop",
    challengeCount: 24,
    maxPoints: 91,
    stars: [1, 6],
  },
  {
    id: "dvwa",
    name: "DVWA",
    blurb: "Damn Vulnerable Web Application: PHP classics at three security levels.",
    accent: "#e53e3e",
    icon: "M12 2 3 7v6c0 5 4 8 9 9 5-1 9-4 9-9V7l-9-5Z",
    repo: "https://github.com/OWASP-CTF/DVWA",
    challengeCount: 55,
    maxPoints: 108,
    stars: [1, 3],
  },
  {
    id: "webgoat",
    name: "WebGoat",
    blurb: "OWASP's guided insecure Java app with lesson-driven exploitation and fixes.",
    accent: "#2563eb",
    icon: "M4 8c2-3 6-4 8-4s6 1 8 4l-2 10a6 6 0 0 1-12 0L4 8Z",
    repo: "https://github.com/OWASP-CTF/WebGoat",
    challengeCount: 83,
    maxPoints: 158,
    stars: [1, 3],
  },
  {
    id: "securityshepherd",
    name: "Security Shepherd",
    blurb: "Web and mobile security training platform with layered challenge levels.",
    accent: "#14b8a6",
    icon: "M12 3 4 9v12h16V9l-8-6ZM9 21v-6h6v6",
    repo: "https://github.com/OWASP-CTF/SecurityShepherd",
    challengeCount: 42,
    maxPoints: 82,
    stars: [1, 3],
  },
  {
    id: "vulnerableapp",
    name: "VulnerableApp",
    blurb: "OWASP's extensible vulnerability playground with the deepest challenge pool.",
    accent: "#22c55e",
    icon: "M12 2v4M12 18v4M2 12h4M18 12h4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
    repo: "https://github.com/OWASP-CTF/VulnerableApp",
    challengeCount: 113,
    maxPoints: 191,
    stars: [1, 3],
  },
  {
    id: "vampi",
    name: "VAmPI",
    blurb: "Vulnerable REST API: the OWASP API Security Top 10 track.",
    accent: "#a1a1aa",
    icon: "M4 6h16v12H4zM4 10h16M8 6v12",
    repo: "https://github.com/OWASP-CTF/VAmPI",
    challengeCount: 9,
    maxPoints: 16,
    stars: [1, 3],
  },
];

export const appsById = Object.fromEntries(apps.map((a) => [a.id, a])) as Record<AppId, AppMeta>;

export const totalChallenges = apps.reduce((n, a) => n + a.challengeCount, 0);
export const totalMaxPoints = apps.reduce((n, a) => n + a.maxPoints, 0);
