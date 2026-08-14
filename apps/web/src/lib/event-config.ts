import type { AppId } from "@/lib/apps";
import { eventConfig as generated } from "@/lib/event-config.generated";

export type EventConfig = {
  name: string;
  theme: string;
  dates: string;
  location: string;
  ctfStartsAt: string | null;
  url: string;
  contactEmail: string;
  targets: readonly AppId[];
  admins: readonly string[];
};

export const eventConfig: EventConfig = generated as unknown as EventConfig;
