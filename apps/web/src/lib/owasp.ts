// Maps an OWASP category code (as carried on a challenge's `owasp` field) to
// the canonical OWASP page for that category. Two families are recognised:
//   - "A01".."A10"   → OWASP Top 10 (2021)
//   - "API1".."API10" → OWASP API Security Top 10 (2023), used by VAmPI
// Anything else (or a malformed code) returns null so the badge renders as
// plain text with no link, rather than pointing somewhere wrong.

const TOP10_SLUG: Record<string, string> = {
  A01: "A01_2021-Broken_Access_Control",
  A02: "A02_2021-Cryptographic_Failures",
  A03: "A03_2021-Injection",
  A04: "A04_2021-Insecure_Design",
  A05: "A05_2021-Security_Misconfiguration",
  A06: "A06_2021-Vulnerable_and_Outdated_Components",
  A07: "A07_2021-Identification_and_Authentication_Failures",
  A08: "A08_2021-Software_and_Data_Integrity_Failures",
  A09: "A09_2021-Security_Logging_and_Monitoring_Failures",
  A10: "A10_2021-Server-Side_Request_Forgery_%28SSRF%29",
};

// API Top 10 (2023) chapter slugs, keyed API1..API10.
const API_SLUG: Record<string, string> = {
  API1: "0xa1-broken-object-level-authorization",
  API2: "0xa2-broken-authentication",
  API3: "0xa3-broken-object-property-level-authorization",
  API4: "0xa4-unrestricted-resource-consumption",
  API5: "0xa5-broken-function-level-authorization",
  API6: "0xa6-unrestricted-access-to-sensitive-business-flows",
  API7: "0xa7-server-side-request-forgery",
  API8: "0xa8-security-misconfiguration",
  API9: "0xa9-improper-inventory-management",
  API10: "0xaa-unsafe-consumption-of-apis",
};

/** Canonical OWASP page for a category code, or null when unmapped. */
export function owaspUrl(code: string | null | undefined): string | null {
  if (!code) return null;
  const key = code.trim().toUpperCase();
  if (TOP10_SLUG[key]) return `https://owasp.org/Top10/${TOP10_SLUG[key]}/`;
  if (API_SLUG[key]) return `https://owasp.org/API-Security/editions/2023/en/${API_SLUG[key]}/`;
  return null;
}
