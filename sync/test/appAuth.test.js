import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mintAppJwt } from "../src/appAuth.js";

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const decode = (part) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

test("mintAppJwt builds a verifiable RS256 JWT with the right claims", () => {
  const now = 1_700_000_000_000; // fixed epoch-ms
  const jwt = mintAppJwt({ appId: "12345", privateKey, now });
  const [h, p, sig] = jwt.split(".");
  assert.deepEqual(decode(h), { alg: "RS256", typ: "JWT" });
  const payload = decode(p);
  assert.equal(payload.iss, "12345");
  assert.equal(payload.iat, Math.floor(now / 1000) - 60); // backdated 60s
  assert.equal(payload.exp, payload.iat + 600);           // <= 10 min
  // Signature verifies against the public key over "header.payload".
  const ok = crypto.createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, sig, "base64url");
  assert.equal(ok, true);
});
