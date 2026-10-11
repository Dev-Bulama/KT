import type { getProject } from "@/modules/projects/service";
import type { Actor } from "@/modules/rbac/actor";

export type ProjectData = Awaited<ReturnType<typeof getProject>>["project"];
export interface TabProps {
  p: ProjectData;
  actor: Actor;
  internal: boolean;
  isAssigned: boolean;
  canWork: boolean;
  sp: Record<string, string | undefined>;
}
