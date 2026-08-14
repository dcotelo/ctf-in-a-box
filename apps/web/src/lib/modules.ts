// CTF module registry. Registration is deliberate: a new vertical is code
// (an entry here) + config (a key under modules. in event.yaml) — never
// config alone. See the kit's docs/modules.md for the full contract.
import type { AppId } from "@/lib/apps";
import { eventConfig } from "@/lib/event-config";

export type ModuleId = "secure-development";

export type ModuleDef = {
  id: ModuleId;
  displayName: string;
  description: string;
  targets: readonly AppId[];
};

export const enabledModules: readonly ModuleDef[] = [
  {
    id: "secure-development",
    displayName: "Secure Development",
    description: "Find the vulnerability, patch it for real, ship the fix as a PR.",
    targets: eventConfig.targets,
  },
];
