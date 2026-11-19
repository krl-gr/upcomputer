import type { SidebarProjectSnapshot } from "../../../../apps/web/src/sidebarProjectGrouping.ts";
import type { TasksWebProject } from "./shared.ts";

/** A project in a task screen, as one member of the sidebar's project group. */
interface GroupedProject {
  readonly id: string;
  /** The sidebar group, within one environment. */
  readonly groupKey: string;
  /** The member a picker offers for the group: the one the sidebar's own picker opens. */
  readonly pickId: string;
}

/**
 * Task screens name projects as the sidebar does: every member of a sidebar
 * group carries the group's label and icon. Tasks keep their own project ids;
 * only names and pickers follow the groups.
 */
export function taskProjectsOf(
  snapshots: ReadonlyArray<SidebarProjectSnapshot>,
): Array<TasksWebProject & Pick<SidebarProjectSnapshot, "defaultModelSelection">> {
  return snapshots.flatMap((snapshot) =>
    snapshot.memberProjects.map((member) => {
      const pick =
        (snapshot.environmentId === member.environmentId ? snapshot : undefined) ??
        snapshot.memberProjects.find(
          (candidate) => candidate.environmentId === member.environmentId,
        ) ??
        member;
      return {
        environmentId: member.environmentId,
        id: member.id,
        name: snapshot.displayName,
        workspaceRoot: member.workspaceRoot,
        repositoryIdentity: member.repositoryIdentity,
        favicon: pick,
        groupKey: `${member.environmentId}\0${snapshot.projectKey}`,
        pickId: pick.id,
        defaultModelSelection: member.defaultModelSelection,
      };
    }),
  );
}

/**
 * What a project picker lists: one entry per group, its `pickId` member when
 * the list still has it, else the group's first member left. Order is kept.
 */
export function pickerProjects<P extends GroupedProject>(projects: ReadonlyArray<P>): P[] {
  const chosen = new Map<string, P>();
  for (const project of projects) {
    const current = chosen.get(project.groupKey);
    if (!current || (project.id === project.pickId && current.id !== current.pickId)) {
      chosen.set(project.groupKey, project);
    }
  }
  return projects.filter((project) => chosen.get(project.groupKey) === project);
}

/** The picker entry that stands for `project`, so a task in any member shows its group as chosen. */
export function pickerProjectFor<P extends GroupedProject>(
  options: ReadonlyArray<P>,
  project: Pick<GroupedProject, "groupKey">,
): P | undefined {
  return options.find((option) => option.groupKey === project.groupKey);
}

/** Whether two task projects are one picker entry; a project the list does not know matches only itself. */
export function sameProjectGroup(
  projects: ReadonlyArray<Pick<GroupedProject, "id" | "groupKey">>,
  a: string | null,
  b: string | null,
): boolean {
  if (a === b) return true;
  const groupOf = (id: string | null) => projects.find((project) => project.id === id)?.groupKey;
  const group = groupOf(a);
  return group !== undefined && group === groupOf(b);
}
