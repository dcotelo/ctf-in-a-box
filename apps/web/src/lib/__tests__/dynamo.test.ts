// Unit tests for the DynamoDB config module — most importantly that the table
// region ignores the ambient AWS_REGION. Vercel injects AWS_REGION with the
// function's own execution region (us-east-1), which once pointed every write
// at the wrong region and failed AccessDenied against the us-west-2-scoped IAM
// policy.

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

async function loadDynamo(env: Record<string, string>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return import("@/lib/dynamo");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("region pinning", () => {
  it("ignores the ambient AWS_REGION Vercel injects", async () => {
    const dynamo = await loadDynamo({ AWS_REGION: "us-east-1", VERCEL: "1" });
    expect(dynamo.AWS_REGION).toBe("us-west-2");
  });

  it("honors an explicit CTF_AWS_REGION override", async () => {
    const dynamo = await loadDynamo({ AWS_REGION: "us-east-1", CTF_AWS_REGION: "eu-west-1" });
    expect(dynamo.AWS_REGION).toBe("eu-west-1");
  });
});

describe("CTF_DATA_BACKEND parsing", () => {
  it("defaults to dual when unset or unknown", async () => {
    expect((await loadDynamo({})).DATA_BACKEND).toBe("dual");
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await loadDynamo({ CTF_DATA_BACKEND: "banana" })).DATA_BACKEND).toBe("dual");
    expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining("banana"));
    consoleWarn.mockRestore();
  });

  it("accepts the two explicit modes", async () => {
    expect((await loadDynamo({ CTF_DATA_BACKEND: "upstash" })).DATA_BACKEND).toBe("upstash");
    expect((await loadDynamo({ CTF_DATA_BACKEND: "dynamo" })).DATA_BACKEND).toBe("dynamo");
  });
});
