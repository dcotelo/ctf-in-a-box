// /faq on a classic-only event. This page is in the header nav, so a
// classic-only event must not link contestants to a page that still tells
// them to fork a target and open a pull request.
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

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/admin-store", () => ({
  getAdminSettings: async () => ({ moduleOverrides: {} }),
}));

vi.mock("@/lib/event-config", () => ({
  eventConfig: {
    name: "Flag Night",
    theme: "",
    dates: "",
    location: "",
    ctfStartsAt: null,
    url: "http://localhost:3000",
    contactEmail: "",
    githubOrg: "OWASP-CTF",
    discordUrl: "",
    modules: [{ id: "classic" }],
    targets: [],
    admins: [],
  },
}));

import Faq from "@/app/(site)/faq/page";

const html = await Faq().then(renderToStaticMarkup);

describe("/faq in a classic-only event", () => {
  it("keeps the platform-wide questions", () => {
    expect(html).toContain("Can I compete solo?");
    expect(html).toContain("Is there a prize?");
    expect(html).toContain("Where do I ask for help during the event?");
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

  it("answers the same questions in classic's own terms", () => {
    expect(html).toContain("How do I submit a flag?");
    expect(html).toContain("Can I retry a flag I got wrong?");
    expect(html).toContain(
      "I submitted the right flag but didn&#x27;t get points. What happened?",
    );
  });

  it("states case/whitespace insensitivity and never claims an attempt cap", () => {
    expect(html).toContain("Does case or extra spacing matter?");
    expect(html).not.toMatch(/\battempts? (remaining|left)\b/i);
  });

  it("keeps the module's questions interleaved with the platform's, not bolted on the end", () => {
    const order = ["Do I need experience to compete?", "Can I compete solo?", "What do I need to bring?"].map(
      (q) => html.indexOf(q),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});
