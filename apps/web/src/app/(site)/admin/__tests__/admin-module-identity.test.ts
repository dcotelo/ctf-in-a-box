// Unit tests for the pure blur-commit decision behind the module identity
// fields (admin-module-identity.tsx): trimming, no-op-when-unchanged, and
// snap-back-on-rejection. Plain function, no React/DOM.
//
// What this file does NOT prove: `patchKey` is taken here as an
// already-consistent input argument, so these tests would stay green even if
// `IdentityField` posted a different key than it renders as `name` — a
// previous version of this comment claimed otherwise, which was wrong (see
// admin-module-identity.binding.test.tsx's header). That binding — the
// posted key equals the rendered `name`, read off the SAME element — is
// proved by `admin-module-identity.binding.test.tsx`, not by this file.
import { describe, expect, it, vi } from "vitest";
import { commitIdentityField } from "@/app/(site)/admin/admin-module-identity";

describe("commitIdentityField", () => {
  it("POSTs the exact patch key it was given, with the trimmed value", async () => {
    const apply = vi.fn().mockResolvedValue(true);
    await commitIdentityField({ patchKey: "moduleTitle:quiz", input: "Round 2", stored: "Round 1", apply });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith({ "moduleTitle:quiz": "Round 2" });
  });

  it("POSTs the blurb key, distinct from the title key, for the same module", async () => {
    const apply = vi.fn().mockResolvedValue(true);
    await commitIdentityField({ patchKey: "moduleBlurb:quiz", input: "New blurb", stored: "", apply });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith({ "moduleBlurb:quiz": "New blurb" });
  });

  it("is a no-op when the trimmed input matches the stored value", async () => {
    const apply = vi.fn();
    const next = await commitIdentityField({ patchKey: "moduleTitle:quiz", input: "Round 1", stored: "Round 1", apply });
    expect(apply).not.toHaveBeenCalled();
    expect(next).toBe("Round 1");
  });

  it("treats whitespace typed over an empty override as still-empty (no POST, no re-dirty)", async () => {
    const apply = vi.fn();
    const next = await commitIdentityField({ patchKey: "moduleTitle:quiz", input: "   ", stored: "", apply });
    expect(apply).not.toHaveBeenCalled();
    expect(next).toBe("");
  });

  it("trims before posting, so leading/trailing whitespace never reaches the wire", async () => {
    const apply = vi.fn().mockResolvedValue(true);
    await commitIdentityField({ patchKey: "moduleTitle:quiz", input: "  Round 2  ", stored: "Round 1", apply });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith({ "moduleTitle:quiz": "Round 2" });
  });

  it("POSTs an empty string to clear an override when the field is emptied", async () => {
    const apply = vi.fn().mockResolvedValue(true);
    const next = await commitIdentityField({ patchKey: "moduleTitle:quiz", input: "", stored: "Round 1", apply });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith({ "moduleTitle:quiz": "" });
    expect(next).toBe("");
  });

  it("snaps back to the stored value when the server rejects the patch", async () => {
    const apply = vi.fn().mockResolvedValue(false);
    const next = await commitIdentityField({ patchKey: "moduleTitle:quiz", input: "bad\x00text", stored: "Round 1", apply });
    expect(next).toBe("Round 1");
  });

  it("keeps the newly-committed value when the server accepts the patch", async () => {
    const apply = vi.fn().mockResolvedValue(true);
    const next = await commitIdentityField({ patchKey: "moduleTitle:quiz", input: "Round 2", stored: "Round 1", apply });
    expect(next).toBe("Round 2");
  });
});
