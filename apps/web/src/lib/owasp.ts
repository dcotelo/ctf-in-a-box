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

// Human-readable category names, kept as their own map rather than derived
// from the slugs above. The slugs LOOK like they encode the label
// ("A01_2021-Broken_Access_Control"), and unpicking them is nearly right —
// until "A10_2021-Server-Side_Request_Forgery_%28SSRF%29", where the
// percent-encoded parens make the derived string wrong in the one place
// nobody would check. Twenty short lines beat a clever transform with an
// exception.
const TOP10_LABEL: Record<string, string> = {
  A01: "Broken Access Control",
  A02: "Cryptographic Failures",
  A03: "Injection",
  A04: "Insecure Design",
  A05: "Security Misconfiguration",
  A06: "Vulnerable and Outdated Components",
  A07: "Identification and Authentication Failures",
  A08: "Software and Data Integrity Failures",
  A09: "Security Logging and Monitoring Failures",
  A10: "Server-Side Request Forgery (SSRF)",
};

const API_LABEL: Record<string, string> = {
  API1: "Broken Object Level Authorization",
  API2: "Broken Authentication",
  API3: "Broken Object Property Level Authorization",
  API4: "Unrestricted Resource Consumption",
  API5: "Broken Function Level Authorization",
  API6: "Unrestricted Access to Sensitive Business Flows",
  API7: "Server-Side Request Forgery",
  API8: "Security Misconfiguration",
  API9: "Improper Inventory Management",
  API10: "Unsafe Consumption of APIs",
};

/** A category code as the UI renders it: the code itself, a readable label,
 *  and a canonical link when one exists.
 *
 *  This mapping lives app-side ON PURPOSE. The scorer knows a challenge's
 *  OWASP *code* — that is rubric data — and nothing about how to present it;
 *  teaching it these slugs and labels would put OWASP's own taxonomy in two
 *  repos and let them drift. The wire carries the code; the UI resolves it. */
export type OwaspCategory = {
  code: string;
  label: string;
  /** null for a code outside both Top 10s — the badge then renders as plain
   *  text. A link that goes nowhere is worse than no link. */
  url: string | null;
};

/** Resolves a code to its category, or undefined when there is no code at all
 *  (a rubric challenge may legitimately carry `owasp: null`).
 *
 *  An UNRECOGNISED code still returns a category, labelled with the code
 *  itself: the code came from the rubric and is worth showing even when this
 *  build cannot name it — dropping it would hide real catalogue data behind a
 *  mapping gap. */
export function owaspCategory(code: string | null | undefined): OwaspCategory | undefined {
  if (!code || !code.trim()) return undefined;
  const key = code.trim().toUpperCase();
  const label = TOP10_LABEL[key] ?? API_LABEL[key];
  return { code: key, label: label ?? key, url: owaspUrl(key) };
}
