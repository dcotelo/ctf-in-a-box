import { describe, expect, it } from "vitest";
import { enabledModules } from "@/lib/modules";
import { enabledApps, apps } from "@/lib/apps";
import { eventConfig } from "@/lib/event-config";

describe("module registry", () => {
  it("exposes secure-development with the config's targets", () => {
    expect(enabledModules).toHaveLength(1);
    expect(enabledModules[0].id).toBe("secure-development");
    expect(enabledModules[0].targets).toEqual(eventConfig.targets);
  });
  it("enabledApps is the config-filtered subset in canonical order", () => {
    expect(enabledApps.map((a) => a.id)).toEqual(apps.filter((a) => eventConfig.targets.includes(a.id)).map((a) => a.id));
    for (const a of enabledApps) expect(eventConfig.targets).toContain(a.id);
  });
});
