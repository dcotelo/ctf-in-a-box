// Config v2: `ADMIN_LOGINS` replaces the baked `event.yaml` `admins:` array
// (issue #386). The badge/hint copy is behind `useState` (`rows` starts
// `null` until the mount effect's fetch resolves), and this repo has no
// @testing-library/act to observe a live re-render — see
// admin-support-tab.test.tsx's header comment for the pattern this follows:
// pin the exported pure values instead of the markup.
//
// The "ADMIN_LOGINS is empty" notice does NOT live on this tab — see the
// comment in admin-admins-tab.tsx for why (this tab is unreachable while the
// env set is empty) — it lives on the Forbidden wall instead; see
// admin-panel.test.tsx.
import { describe, expect, it } from "vitest";
import { ENV_ADMIN_BADGE, ENV_ADMIN_CHANGE_HINT } from "@/app/(site)/admin/admin-admins-tab";

describe("env-admin badge copy", () => {
  it("points at .env / restart, not the dead event.yaml / rebuild bake", () => {
    expect(ENV_ADMIN_BADGE).toBe(".env");
    expect(ENV_ADMIN_CHANGE_HINT).toBe("restart to change");
  });
});
