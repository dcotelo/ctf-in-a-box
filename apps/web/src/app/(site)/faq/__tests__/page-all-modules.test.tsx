// /faq on an all-modules event — the shape the wizard produces by default,
// and the one case the suite never covered.
//
// Every module writes the reader's questions rather than its own, so the
// generic ones collide by design: all three have a "do I need experience" and
// a "what do I need to bring". Concatenating the contributions rendered the
// same question text three times, as three identical collapsed rows.
//
// It shipped precisely because the only FAQ tests here were quiz-only and
// classic-only, and a single-module event cannot collide. This file is the
// missing half: it pins that questions are unique on the page and that no
// module's answer was dropped to achieve that.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/admin-store", () => ({
  getAdminSettings: async () => ({ moduleOverrides: {} }),
}));

vi.mock("@/lib/event-config", () => ({
  eventConfig: {
    name: "CTF in a box test",
    theme: "",
    dates: "",
    location: "",
    ctfStartsAt: null,
    url: "http://localhost:3000",
    contactEmail: "",
    githubOrg: "ctf-in-a-box-test",
    discordUrl: "",
    modules: [
      { id: "secure-development", targets: ["juice-shop", "dvwa"], scoreIngest: "poll" },
      { id: "quiz" },
      { id: "classic" },
    ],
    targets: ["juice-shop", "dvwa"],
    admins: [],
  },
}));

import Faq from "@/app/(site)/faq/page";

const html = await Faq().then(renderToStaticMarkup);

/** Every rendered question, in page order. The accordion puts each one in its
 *  own <button>, which is the only place the question text appears. */
function questions(): string[] {
  // `[\s\S]` rather than `.` with the `s` flag: this tsconfig targets below
  // es2018, where dotAll is a compile error.
  const re = /<button[^>]*>(?:(?!<\/button>)[\s\S])*?<span[^>]*>([\s\S]*?)<\/span>/g;
  return [...html.matchAll(re)].map((m) => m[1].replace(/<[^>]*>/g, "").trim());
}

describe("/faq with every module enabled", () => {
  it("renders each question exactly once", () => {
    const seen = questions();
    expect(seen.length).toBeGreaterThan(0);
    const duplicated = seen.filter((q, i) => seen.indexOf(q) !== i);
    expect(duplicated).toEqual([]);
  });

  it("still asks the questions every module contributes", () => {
    const seen = questions();
    expect(seen).toContain("Do I need experience to compete?");
    expect(seen).toContain("What do I need to bring?");
  });

  it("keeps the platform-wide questions", () => {
    expect(html).toContain("Can I compete solo?");
    expect(html).toContain("Is there a prize?");
    expect(html).toContain("Where do I ask for help during the event?");
  });

  it("keeps every module's answer to a shared question, labelled by module", () => {
    // The three "do I need experience" answers differ only in what they name —
    // targets, questions, flags. Losing one to a dedupe would be silent, so
    // assert each distinctive fragment survives.
    expect(html).toContain("Start with a low-point challenge on any app");
    expect(html).toContain("Start with whichever question looks approachable");
    expect(html).toContain("Start with whichever one looks approachable");
    // …and that a reader can tell whose answer is whose.
    for (const title of ["Secure Development", "Quiz", "Classic CTF"]) {
      expect(html).toContain(title);
    }
  });
});
