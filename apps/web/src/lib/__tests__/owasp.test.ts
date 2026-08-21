import { describe, expect, it } from "vitest";
import { owaspCategory, owaspUrl } from "@/lib/owasp";

describe("owaspUrl", () => {
  it("maps Top 10 (2021) codes to their category page", () => {
    expect(owaspUrl("A01")).toBe("https://owasp.org/Top10/A01_2021-Broken_Access_Control/");
    expect(owaspUrl("A03")).toBe("https://owasp.org/Top10/A03_2021-Injection/");
    expect(owaspUrl("A10")).toBe("https://owasp.org/Top10/A10_2021-Server-Side_Request_Forgery_%28SSRF%29/");
  });

  it("maps API Security Top 10 (2023) codes to their chapter", () => {
    expect(owaspUrl("API1")).toBe(
      "https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/",
    );
    expect(owaspUrl("API10")).toBe("https://owasp.org/API-Security/editions/2023/en/0xaa-unsafe-consumption-of-apis/");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(owaspUrl(" a05 ")).toBe("https://owasp.org/Top10/A05_2021-Security_Misconfiguration/");
  });

  it("returns null for unmapped or empty codes", () => {
    expect(owaspUrl(null)).toBeNull();
    expect(owaspUrl("")).toBeNull();
    expect(owaspUrl("A99")).toBeNull();
    expect(owaspUrl("CWE-79")).toBeNull();
  });
});

describe("owaspCategory", () => {
  it("resolves a Top 10 code to code, label and link", () => {
    expect(owaspCategory("A03")).toEqual({
      code: "A03",
      label: "Injection",
      url: "https://owasp.org/Top10/A03_2021-Injection/",
    });
  });

  it("resolves an API Top 10 code the same way", () => {
    expect(owaspCategory("API3")).toEqual({
      code: "API3",
      label: "Broken Object Property Level Authorization",
      url: "https://owasp.org/API-Security/editions/2023/en/0xa3-broken-object-property-level-authorization/",
    });
  });

  it("normalises case and surrounding whitespace", () => {
    expect(owaspCategory("  a01 ")?.code).toBe("A01");
    expect(owaspCategory("  a01 ")?.label).toBe("Broken Access Control");
  });

  // The label map is kept separate from the slug map rather than derived from
  // it, because this is the entry where unpicking the slug goes wrong: the
  // percent-encoded parens in "A10_2021-...Forgery_%28SSRF%29".
  it("labels A10 without leaking the URL encoding from its slug", () => {
    const a10 = owaspCategory("A10");
    expect(a10?.label).toBe("Server-Side Request Forgery (SSRF)");
    expect(a10?.label).not.toContain("%28");
    expect(a10?.label).not.toContain("_");
  });

  // A rubric challenge may carry no category at all — every declarative
  // `<target>.yaml` rubric does, that grammar having no owasp field.
  it("returns undefined when there is no code", () => {
    expect(owaspCategory(null)).toBeUndefined();
    expect(owaspCategory(undefined)).toBeUndefined();
    expect(owaspCategory("   ")).toBeUndefined();
  });

  // An unmapped code is still real catalogue data. Keep it, labelled with
  // itself and unlinked, rather than hiding it behind a gap in this mapping.
  it("keeps an unrecognised code, labelled with itself and unlinked", () => {
    expect(owaspCategory("CWE-79")).toEqual({ code: "CWE-79", label: "CWE-79", url: null });
  });

  it("agrees with owaspUrl on every code it maps", () => {
    for (const code of ["A01", "A10", "API1", "API10", "ZZZ"]) {
      expect(owaspCategory(code)?.url ?? null).toBe(owaspUrl(code));
    }
  });
});
