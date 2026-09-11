// Config v2: `ADMIN_LOGINS` replaces the baked `event.yaml` `admins:` array
// (issue #386). The tab's badge/hint copy and its fail-closed notice for an
// empty allowlist are both behind `useState` (`rows` starts `null` until the
// mount effect's fetch resolves), and this repo has no @testing-library/act
// to observe a live re-render — see admin-support-tab.test.tsx's header
// comment for the pattern this follows: pin the exported pure values/helper
// instead of the markup.
import { describe, expect, it } from "vitest";
import {
  ENV_ADMIN_BADGE,
  ENV_ADMIN_CHANGE_HINT,
  envAdminsEmptyNotice,
} from "@/app/(site)/admin/admin-admins-tab";

describe("env-admin badge copy", () => {
  it("points at .env / restart, not the dead event.yaml / rebuild bake", () => {
    expect(ENV_ADMIN_BADGE).toBe(".env");
    expect(ENV_ADMIN_CHANGE_HINT).toBe("restart to change");
  });
});

describe("envAdminsEmptyNotice", () => {
  it("says nothing before rows have loaded", () => {
    expect(envAdminsEmptyNotice(null)).toBeNull();
  });

  it("says nothing once there is at least one env admin", () => {
    expect(envAdminsEmptyNotice([{ login: "alice", baked: true }])).toBeNull();
  });

  it("says nothing when there is an env admin alongside runtime grants", () => {
    expect(
      envAdminsEmptyNotice([
        { login: "alice", baked: true },
        { login: "carol", baked: false },
      ]),
    ).toBeNull();
  });

  it("warns when ADMIN_LOGINS is empty, even with runtime grants present", () => {
    expect(envAdminsEmptyNotice([{ login: "carol", baked: false }])).toBe(
      "ADMIN_LOGINS is empty — nobody can use /admin until it is set and the app restarts.",
    );
  });

  it("warns when there are no rows at all", () => {
    expect(envAdminsEmptyNotice([])).toBe(
      "ADMIN_LOGINS is empty — nobody can use /admin until it is set and the app restarts.",
    );
  });
});
