import type { AppId } from "@/lib/apps";
import { eventConfig as generated } from "@/lib/event-config.generated";

export type SecureDevelopmentConfig = {
  id: "secure-development";
  targets: readonly AppId[];
  scoreIngest: "poll" | "push";
};
export type QuizConfig = { id: "quiz" };
export type AiConfig = { id: "ai" };
export type ModuleConfig = SecureDevelopmentConfig | QuizConfig | AiConfig;

export type EventConfig = {
  name: string;
  theme: string;
  dates: string;
  location: string;
  ctfStartsAt: string | null;
  contactEmail: string;
  githubOrg: string;
  discordUrl: string;
  targets: readonly AppId[];
  modules: readonly ModuleConfig[];
  admins: readonly string[];
};

export const eventConfig: EventConfig = generated as unknown as EventConfig;
