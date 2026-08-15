import crypto from "node:crypto";

const b64url = (input) => Buffer.from(input).toString("base64url");

// Short-lived GitHub App JWT (RS256), hand-rolled — no jsonwebtoken dependency.
// iat is backdated 60s for clock skew; exp is capped at 10 min per GitHub's limit.
export function mintAppJwt({ appId, privateKey, now = Date.now() }) {
  const iat = Math.floor(now / 1000) - 60;
  const exp = iat + 600;
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iat, exp, iss: String(appId) }));
  const signingInput = `${header}.${payload}`;
  const signature = crypto.createSign("RSA-SHA256").update(signingInput).sign(privateKey, "base64url");
  return `${signingInput}.${signature}`;
}
