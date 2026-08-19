// /code-of-conduct on a quiz-only event.
//
// Footer-linked from every page, and it carried secure-development's
// vocabulary in two places: the code applying to "the OWASP-CTF GitHub
// organization, and any pull requests or reviews you take part in" (an event
// without that module has no such org activity), and reporting "a bug in a
// challenge or the scorer".
//
// Own file for the usual `vi.mock` hoisting reason.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  findSecureDevLeaks,
  normalizeHtml,
  SECURE_DEV_PATTERNS,
  SECURE_DEV_TERMS,
} from "../../__tests__/secure-dev-terms";

vi.mock("@/lib/event-config", () => ({
  eventConfig: {
    name: "Quiz Night",
    theme: "",
    dates: "",
    location: "",
    ctfStartsAt: null,
    url: "http://localhost:3000",
    contactEmail: "organizers@example.com",
    githubOrg: "OWASP-CTF",
    discordUrl: "",
    modules: [{ id: "quiz" }],
    targets: [],
    admins: [],
  },
}));

import CodeOfConduct from "@/app/(site)/code-of-conduct/page";

const html = renderToStaticMarkup(CodeOfConduct());

describe("/code-of-conduct in a quiz-only event", () => {
  it("keeps the whole of the platform's conduct copy", () => {
    expect(html).toContain("OWASP Code of Conduct");
    expect(html).toContain("Harassment of any kind ends your event.");
    expect(html).toContain("Which code applies");
    expect(html).toContain("Reporting a problem");
    expect(html).toContain("You do not need to have been harmed yourself to report something");
    expect(html).toContain("organizers@example.com");
  });

  it("renders no secure-development copy", () => {
    expect(findSecureDevLeaks(html)).toEqual([]);
  });

  it.each(SECURE_DEV_TERMS)("does not leak %j", (term) => {
    expect(normalizeHtml(html)).not.toContain(term);
  });

  it.each(SECURE_DEV_PATTERNS)("does not leak %s", (pattern) => {
    expect(html).not.toMatch(pattern);
  });

  it("says where the code reaches without naming a GitHub org this event doesn't use", () => {
    expect(html).toContain("applies to the CTF Discord and to every space this event runs in");
  });
});
