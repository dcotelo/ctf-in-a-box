import { describe, expect, it } from "vitest";
import { owaspUrl } from "@/lib/owasp";

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
