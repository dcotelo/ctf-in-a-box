// Removing a runtime admin now asks first, through the panel's own dialog
// (audit F8). Before: removing someone ELSE fired on the click with no gate,
// and removing yourself used `window.confirm` — the only native dialog in the
// panel, skipping the focus-managed styled one every other destructive action
// here uses.
import { describe, expect, it } from "vitest";
import { adminRemoveConfirm } from "@/app/(site)/admin/admin-admins-tab";

describe("adminRemoveConfirm", () => {
  it("names the person being removed, and what they lose", () => {
    const { title, body, confirmLabel } = adminRemoveConfirm("octocat", "diego");
    expect(title).toBe("Remove octocat as an admin?");
    expect(body).toContain("octocat");
    expect(body).toMatch(/immediately/);
    expect(confirmLabel).toBe("Remove admin");
  });

  it("says the removal is recoverable, because it is", () => {
    expect(adminRemoveConfirm("octocat", "diego").body).toMatch(/grant it back/);
  });

  it("keeps the sharper sentence for removing yourself", () => {
    const { title, body } = adminRemoveConfirm("diego", "diego");
    expect(title).toBe("Remove your own admin access?");
    expect(body).toContain("You will lose this panel immediately.");
    // The way back matters most in exactly this case.
    expect(body).toMatch(/event\.yaml/);
  });

  it("recognises yourself whatever the case — GitHub logins are unique case-insensitively", () => {
    expect(adminRemoveConfirm("Diego", "diego").title).toBe("Remove your own admin access?");
    expect(adminRemoveConfirm("diego", "DIEGO").title).toBe("Remove your own admin access?");
  });
});
