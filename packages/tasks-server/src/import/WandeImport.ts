/**
 * Imports one user's wande data from a Convex snapshot as person tasks,
 * routines and schedule entries. Run it with the server stopped (`t3 tasks
 * import-wande`): it writes through the repository, so ranks, reminders and
 * list revisions are right, but a running server would not hear the changes.
 *
 * Every imported task and entry has an id derived from its wande id, so a
 * rerun only adds what is missing and never changes what is there.
 */
import { ProjectId } from "@t3tools/contracts";
import { TaskError, type TaskRank, type TaskScheduleEntry } from "@t3tools/tasks-contracts/v1";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import { makeFeatureProjects, ProjectStoreV2 } from "../../../../apps/server/src/extensionApi.ts";
import { InboxProject, InboxProjectLive } from "../inbox/InboxProject.ts";
import { TaskRepository } from "../persistence/TaskRepository.ts";
import { TaskRepositoryLive } from "../persistence/TaskRepositoryLive.ts";
import { taskRanksBetween } from "../persistence/taskRank.ts";
import {
  planWandeImport,
  readWandeUser,
  type PlannedGroup,
  type WandePlan,
  type WandeSnapshotTables,
} from "./wandePlan.ts";

export {
  folderNameForTitle,
  WANDE_TABLES,
  type WandeSnapshotTables,
  type WandeTable,
} from "./wandePlan.ts";

export interface WandeImportInput {
  readonly tables: WandeSnapshotTables;
  readonly email: string;
  /** A wande project's folder: the user's mapping, else the projects folder plus its title. */
  readonly rootFor: (title: string) => string;
  /** Plan only: nothing is written and no folder is created. */
  readonly dryRun: boolean;
}

interface Counts {
  todo: number;
  done: number;
  archived: number;
}

export interface WandeImportGroupReport {
  readonly target: PlannedGroup["target"];
  readonly wandeProjects: ReadonlyArray<string>;
  readonly tasks: Counts;
  readonly routines: Counts;
  /** Tasks and routines of this group not imported before. */
  readonly added: number;
  /** The project the group's tasks went to; null in a dry run or when nothing was added. */
  readonly projectId: string | null;
}

export interface WandeImportReport {
  readonly dryRun: boolean;
  readonly groups: ReadonlyArray<WandeImportGroupReport>;
  readonly skippedProjects: ReadonlyArray<string>;
  readonly unknownProjectItems: number;
  readonly malformed: Readonly<Record<string, number>>;
  readonly tasks: { readonly planned: number; readonly existing: number; readonly added: number };
  readonly routines: {
    readonly planned: number;
    readonly existing: number;
    readonly added: number;
  };
  readonly entries: {
    readonly planned: number;
    readonly existing: number;
    readonly added: number;
    readonly byStatus: Readonly<Record<TaskScheduleEntry["status"], number>>;
    readonly timed: number;
  };
  readonly history: WandePlan["history"];
  readonly invalidDates: number;
  readonly projectsCreated: number;
}

/** The task services `importWande` needs on top of core projects and the database. */
export const WandeImportServicesLive = InboxProjectLive.pipe(
  Layer.provideMerge(TaskRepositoryLive),
);

const importError = (message: string, cause?: unknown) => new TaskError({ message, cause });

/** The tasks and entries a rerun finds already imported. */
const existingIds = Effect.fn("WandeImport.existingIds")(function* (
  table: "tasks" | "entries",
  ids: ReadonlyArray<string>,
) {
  const sql = yield* SqlClient.SqlClient;
  const idsJson = JSON.stringify(ids);
  const rows = yield* table === "tasks"
    ? sql<{ readonly id: string }>`
          SELECT id FROM tasks WHERE id IN (SELECT value FROM json_each(${idsJson}))`
    : sql<{ readonly id: string }>`
          SELECT id FROM task_schedule_entries
          WHERE id IN (SELECT value FROM json_each(${idsJson}))`;
  return new Set(rows.map(({ id }) => id));
});

export const importWande = Effect.fn("importWande")(function* (input: WandeImportInput) {
  const data = yield* Effect.try({
    try: () => readWandeUser(input.tables, input.email),
    catch: (cause) =>
      importError(cause instanceof Error ? cause.message : "Could not read the snapshot.", cause),
  });
  const repository = yield* TaskRepository;
  const inbox = yield* InboxProject;
  const projects = yield* makeFeatureProjects;
  const sql = yield* SqlClient.SqlClient;
  const store = yield* ProjectStoreV2;

  const existingProjects = (yield* store.list())
    .filter(({ deletedAt }) => deletedAt === null)
    .map(({ projectId, title, workspaceRoot }) => ({ id: projectId, title, workspaceRoot }));
  const plan = planWandeImport({ data, existingProjects, rootFor: input.rootFor });

  const importedTasks = yield* existingIds(
    "tasks",
    plan.tasks.map(({ id }) => id),
  );
  const importedEntries = yield* existingIds(
    "entries",
    plan.entries.map(({ id }) => id),
  );
  const newTasks = plan.tasks.filter(({ id }) => !importedTasks.has(id));
  const newEntries = plan.entries.filter(({ id }) => !importedEntries.has(id));

  const projectIds = new Map<string, ProjectId>();
  let projectsCreated = 0;
  if (!input.dryRun) {
    for (const group of plan.groups) {
      if (!newTasks.some(({ groupKey }) => groupKey === group.key)) continue;
      const { target } = group;
      if (target.type === "inbox") projectIds.set(group.key, yield* inbox.ensure);
      else if (target.type === "existing")
        projectIds.set(group.key, ProjectId.make(target.projectId));
      else {
        const project = yield* projects.ensureProjectForWorkspaceRoot(target);
        projectsCreated += 1;
        projectIds.set(group.key, project.id);
      }
    }

    // Imported tasks go after every existing task, in wande's order.
    const last = yield* sql<{
      readonly rank: TaskRank | null;
    }>`SELECT MAX(rank) AS rank FROM tasks`;
    const ranks = taskRanksBetween(last[0]?.rank ?? null, null, newTasks.length);
    if (ranks === null) return yield* importError("No room in the task order for the import.");

    // A date's new entries go after its existing ones, in wande's order.
    const dates = [...new Set(newEntries.map(({ date }) => date))];
    const lastOnDate = new Map<string, string>();
    for (const entry of dates.length === 0 ? [] : yield* repository.scheduleEntries({ dates })) {
      lastOnDate.set(entry.date, entry.position);
    }
    const positions = new Map<string, TaskRank>();
    for (const date of dates) {
      const onDate = newEntries.filter((entry) => entry.date === date);
      const between = taskRanksBetween(lastOnDate.get(date) ?? null, null, onDate.length);
      if (between === null) return yield* importError(`No room in the schedule of ${date}.`);
      onDate.forEach((entry, index) => positions.set(entry.id, between[index]!));
    }

    const now = DateTime.formatIso(yield* DateTime.now);
    yield* repository.withChangeTransaction(
      Effect.gen(function* () {
        for (const [index, task] of newTasks.entries()) {
          yield* repository.upsert({
            id: task.id,
            rank: ranks[index]!,
            projectId: projectIds.get(task.groupKey)!,
            title: task.title,
            description: task.description,
            output: null,
            status: task.status,
            priority: null,
            createdBy: "user",
            assigneeAgentRunId: null,
            sourceThreadId: null,
            sourceRunId: null,
            metadata: {
              source: "wande",
              wandeId: task.wandeId,
              wandeProjectId: task.wandeProjectId,
            },
            tags: [],
            createdAt: task.createdAt,
            updatedAt: now,
            archivedAt: task.archived ? now : null,
            notBefore: null,
            audience: "person",
            kind: task.kind,
          });
        }
        if (newEntries.length > 0) {
          yield* repository.putScheduleEntries(
            newEntries.map((entry): TaskScheduleEntry => ({
              id: entry.id,
              taskId: entry.taskId,
              date: entry.date,
              position: positions.get(entry.id)!,
              startTime: entry.startTime,
              durationMinutes: entry.durationMinutes,
              status: entry.status,
              createdAt: entry.createdAt,
              updatedAt: entry.updatedAt,
            })),
          );
        }
      }),
    );
  }

  const counts = (kind: "task" | "routine", groupKey: string): Counts => {
    const items = plan.tasks.filter((task) => task.kind === kind && task.groupKey === groupKey);
    return {
      todo: items.filter((task) => !task.archived && task.status === "To Do").length,
      done: items.filter((task) => !task.archived && task.status === "Done").length,
      archived: items.filter((task) => task.archived).length,
    };
  };
  const totals = (kind: "task" | "routine") => ({
    planned: plan.tasks.filter((task) => task.kind === kind).length,
    existing: plan.tasks.filter((task) => task.kind === kind && importedTasks.has(task.id)).length,
    added: input.dryRun ? 0 : newTasks.filter((task) => task.kind === kind).length,
  });
  return {
    dryRun: input.dryRun,
    groups: plan.groups.map((group) => ({
      target: group.target,
      wandeProjects: group.wandeProjects,
      tasks: counts("task", group.key),
      routines: counts("routine", group.key),
      added: newTasks.filter(({ groupKey }) => groupKey === group.key).length,
      projectId: projectIds.get(group.key) ?? null,
    })),
    skippedProjects: plan.skippedProjects,
    unknownProjectItems: plan.unknownProjectItems,
    malformed: data.malformed,
    tasks: totals("task"),
    routines: totals("routine"),
    entries: {
      planned: plan.entries.length,
      existing: importedEntries.size,
      added: input.dryRun ? 0 : newEntries.length,
      byStatus: {
        open: plan.entries.filter(({ status }) => status === "open").length,
        done: plan.entries.filter(({ status }) => status === "done").length,
        skipped: plan.entries.filter(({ status }) => status === "skipped").length,
      },
      timed: plan.entries.filter(({ startTime }) => startTime !== null).length,
    },
    history: plan.history,
    invalidDates: plan.invalidDates,
    projectsCreated,
  } satisfies WandeImportReport;
});

/** The report as lines for a terminal: counts and project titles only. */
export function formatWandeImportReport(report: WandeImportReport): string {
  const counts = ({ todo, done, archived }: Counts) =>
    `${todo} to do, ${done} done, ${archived} archived`;
  const lines = [report.dryRun ? "Dry run: nothing was written." : "Import done.", "", "Projects:"];
  for (const group of report.groups) {
    const { target } = group;
    const where =
      target.type === "inbox"
        ? "Inbox (tasks without a project)"
        : target.type === "existing"
          ? `existing "${target.title}" at ${target.workspaceRoot} (matched by ${target.matchedBy})`
          : `${report.dryRun ? "new" : "created"} "${target.title}" at ${target.workspaceRoot}`;
    lines.push(`- ${where}`);
    if (group.wandeProjects.length > 0) {
      lines.push(`    from wande: ${group.wandeProjects.map((title) => `"${title}"`).join(", ")}`);
    }
    lines.push(`    tasks: ${counts(group.tasks)}`);
    const routines = group.routines.todo + group.routines.done + group.routines.archived;
    if (routines > 0) lines.push(`    routines: ${counts(group.routines)}`);
    if (!report.dryRun) lines.push(`    added now: ${group.added}`);
  }
  if (report.skippedProjects.length > 0) {
    lines.push(
      `Skipped (no tasks or routines): ${report.skippedProjects.map((title) => `"${title}"`).join(", ")}`,
    );
  }
  if (report.unknownProjectItems > 0) {
    lines.push(
      `Items naming a missing wande project (sent to the Inbox): ${report.unknownProjectItems}`,
    );
  }
  const added = (part: { planned: number; existing: number; added: number }) =>
    `${part.planned} in wande, ${part.existing} imported before${report.dryRun ? "" : `, ${part.added} added`}`;
  lines.push(
    "",
    `Tasks: ${added(report.tasks)}`,
    `Routines: ${added(report.routines)}`,
    `Schedule entries: ${added(report.entries)}`,
    `  ${report.entries.byStatus.open} open, ${report.entries.byStatus.done} done, ${report.entries.byStatus.skipped} skipped; ${report.entries.timed} timed`,
    `Old history (instances whose task or routine id is gone): ${report.history.matched} matched by title, ${report.history.ambiguous} skipped as ambiguous, ${report.history.none} skipped without a match`,
  );
  if (report.invalidDates > 0)
    lines.push(`Instances skipped for an invalid date: ${report.invalidDates}`);
  const malformed = Object.entries(report.malformed);
  if (malformed.length > 0) {
    lines.push(
      `Rows skipped for missing fields: ${malformed.map(([table, count]) => `${table} ${count}`).join(", ")}`,
    );
  }
  if (!report.dryRun) lines.push(`Projects created: ${report.projectsCreated}`);
  return lines.join("\n");
}
