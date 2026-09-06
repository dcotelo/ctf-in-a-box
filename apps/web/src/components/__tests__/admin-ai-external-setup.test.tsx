// The panel's answer to "what does the other end have to do?". These assert
// the CLAIMS, not the prose: each one is a fact an integrator implements
// against, and a drifting number here (the ±300s window, the signed string's
// shape, which key is the secret one) sends somebody debugging a signature
// failure that looks exactly like a wrong key.
//
// @testing-library/react is not a dependency of this repo and must not be
// added for a test — the component is pure props inside a native <details>,
// so `renderToStaticMarkup` sees everything an organizer sees once it is
// open (the content is in the markup either way).
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import AiExternalSetup, { EXTERNAL_STEPS, KEY_ROLES } from "@/components/admin-ai-external-setup";

const html = () => renderToStaticMarkup(<AiExternalSetup origin="https://event.example" />);

describe("EXTERNAL_STEPS", () => {
  it("covers the handshake in the order it happens, ending at the replay guard", () => {
    expect(EXTERNAL_STEPS.map((s) => s.title)).toEqual([
      "Take the token out of the launch URL",
      "Verify it with the launch key",
      "Read live progress, if you show any",
      "Report the solve, signed",
      "Expect one award per token",
    ]);
  });

  it("states the signature exactly — the bytes, the headers, and the window", () => {
    const signing = EXTERNAL_STEPS.find((s) => s.title === "Report the solve, signed")!.body;
    expect(signing).toContain('"<unix-timestamp>.<raw request body>"');
    expect(signing).toContain("X-CTF-Signature: sha256=<hex>");
    expect(signing).toContain("X-CTF-Timestamp");
    expect(signing).toContain("±300 seconds");
    // The mistake that costs the most, said where somebody will read it.
    expect(signing).toContain("Re-serializing the body before signing");
  });

  it("tells the verifier not to trust the token's own algorithm or key id", () => {
    const verify = EXTERNAL_STEPS.find((s) => s.title === "Verify it with the launch key")!.body;
    expect(verify).toContain("hard-coded Ed25519");
    expect(verify).toContain("pin the audience");
    expect(verify).toMatch(/never let the token's own alg or kid/);
  });

  it("names the replay rule in the terms the box answers in", () => {
    const replay = EXTERNAL_STEPS.find((s) => s.title === "Expect one award per token")!.body;
    expect(replay).toContain("jti");
    expect(replay).toContain("409");
    expect(replay).toContain("Send test");
  });
});

describe("KEY_ROLES", () => {
  it("keeps the two keys distinguishable on every axis that matters", () => {
    const [launch, signing] = KEY_ROLES;
    expect(launch.key).toBe("Launch key");
    expect(launch.scope).toBe("One per event");
    expect(launch.secrecy).toMatch(/Public/);
    expect(launch.job).toMatch(/FETCH/);
    expect(signing.key).toBe("Signing key");
    expect(signing.scope).toBe("One per challenge");
    expect(signing.secrecy).toMatch(/Secret/);
    expect(signing.job).toMatch(/PASTE/);
  });
});

describe("AiExternalSetup", () => {
  it("is a collapsed drawer — read once while wiring, never again", () => {
    expect(html()).toContain("<details");
    expect(html()).not.toMatch(/<details[^>]*open=/);
    expect(html()).toContain("Wiring the external site");
  });

  it("renders every step and both key roles", () => {
    const markup = html();
    for (const step of EXTERNAL_STEPS) expect(markup).toContain(step.title);
    for (const role of KEY_ROLES) expect(markup).toContain(role.job);
  });

  it("shows the launch-key endpoint against the real origin", () => {
    expect(html()).toContain("https://event.example/api/ai/launch-key");
  });

  it("links the contract, and never prints a signing key of its own", () => {
    const markup = html();
    expect(markup).toContain("ai-module");
    // The per-challenge secret belongs to the row panel, masked. Nothing
    // key-shaped may reach this markup — not even a placeholder that could be
    // mistaken for one.
    expect(markup).not.toContain("aik_");
  });
});
