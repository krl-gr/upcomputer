/**
 * Reading a wande (Convex) snapshot and planning its import, without I/O.
 * `WandeImport.ts` applies the plan. Only the chosen user's rows survive
 * parsing: every other row is dropped while its line is read.
 */
import {
  PERSON_DONE_STATUS,
  PERSON_OPEN_STATUS,
  TaskId,
  TaskScheduleDate,
  TaskScheduleEntryId,
  TaskScheduleTime,
  type TaskKind,
  type TaskScheduleEntryStatus,
} from "@t3tools/tasks-contracts/v1";
import * as Schema from "effect/Schema";

export const WANDE_TABLES = ["users", "projects", "tasks", "routines", "queueInstances"] as const;
export type WandeTable = (typeof WANDE_TABLES)[number];
/** Each table's `documents.jsonl` text. */
export type WandeSnapshotTables = Readonly<Record<WandeTable, string>>;

export interface WandeProject {
  readonly id: string;
  readonly title: string;
  readonly archived: boolean;
  readonly order: number;
}

export interface WandeEntity {
  readonly id: string;
  readonly kind: TaskKind;
  readonly title: string;
  readonly content: string;
  readonly order: number;
  readonly projectId: string | null;
  readonly status: "new" | "done" | "archive";
  readonly createdAt: number;
}

export interface WandeInstance {
  readonly id: string;
  readonly entityId: string;
  readonly kind: TaskKind;
  readonly title: string;
  readonly date: string;
  readonly order: number;
  readonly status: "new" | "done" | "archived";
  readonly startTime: string | null;
  readonly duration: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** One user's projects, tasks with routines, and queue instances. */
export interface WandeUserData {
  readonly projects: ReadonlyArray<WandeProject>;
  readonly entities: ReadonlyArray<WandeEntity>;
  readonly instances: ReadonlyArray<WandeInstance>;
  /** The user's rows that lack a field the import needs, per table. */
  readonly malformed: Readonly<Record<string, number>>;
}

type Row = Record<string, unknown>;

const isString = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const optionalString = (value: unknown) => (isString(value) ? value : null);

function* rowsOf(table: WandeTable, text: string): Generator<Row> {
  let line = 0;
  for (const raw of text.split("\n")) {
    line += 1;
    if (raw.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Line ${line} of the ${table} table is not JSON.`);
    }
    if (typeof parsed === "object" && parsed !== null) yield parsed as Row;
  }
}

/**
 * The rows of the one user with this email. Throws when no user or more than
 * one has it, or when a line is not JSON.
 */
export function readWandeUser(tables: WandeSnapshotTables, email: string): WandeUserData {
  const wanted = email.trim().toLowerCase();
  const userIds: string[] = [];
  for (const row of rowsOf("users", tables.users)) {
    if (isString(row.email) && row.email.trim().toLowerCase() === wanted && isString(row._id)) {
      userIds.push(row._id);
    }
  }
  if (userIds.length !== 1) {
    throw new Error(
      userIds.length === 0
        ? `No user in the snapshot has the email ${email}.`
        : `${userIds.length} users in the snapshot have the email ${email}.`,
    );
  }
  const userId = userIds[0];
  const malformed: Record<string, number> = {};
  const mine = function* (table: WandeTable) {
    for (const row of rowsOf(table, tables[table])) if (row.user_id === userId) yield row;
  };
  const skip = (table: WandeTable) => {
    malformed[table] = (malformed[table] ?? 0) + 1;
  };

  const projects: WandeProject[] = [];
  for (const row of mine("projects")) {
    if (!isString(row._id) || !isString(row.title)) {
      skip("projects");
      continue;
    }
    projects.push({
      id: row._id,
      title: row.title,
      archived: row.status === "archive",
      order: isNumber(row.order_num) ? row.order_num : 0,
    });
  }

  const entities: WandeEntity[] = [];
  for (const [table, kind] of [
    ["tasks", "task"],
    ["routines", "routine"],
  ] as const) {
    for (const row of mine(table)) {
      const status = row.status;
      if (
        !isString(row._id) ||
        !isString(row.title) ||
        row.title.trim().length === 0 ||
        (status !== "new" && status !== "done" && status !== "archive")
      ) {
        skip(table);
        continue;
      }
      entities.push({
        id: row._id,
        kind,
        title: row.title.trim(),
        content: optionalString(row.content) ?? "",
        order: isNumber(row.order) ? row.order : 0,
        projectId: optionalString(row.project_id),
        status,
        createdAt: isNumber(row._creationTime) ? row._creationTime : 0,
      });
    }
  }

  const instances: WandeInstance[] = [];
  for (const row of mine("queueInstances")) {
    const status = row.status;
    if (
      !isString(row._id) ||
      !isString(row.entity_id) ||
      !isString(row.title) ||
      !isString(row.date) ||
      (row.entity_type !== "task" && row.entity_type !== "routine") ||
      (status !== "new" && status !== "done" && status !== "archived")
    ) {
      skip("queueInstances");
      continue;
    }
    const createdAt = isNumber(row._creationTime) ? row._creationTime : 0;
    instances.push({
      id: row._id,
      entityId: row.entity_id,
      kind: row.entity_type,
      title: row.title,
      date: row.date,
      order: isNumber(row.order) ? row.order : 0,
      status,
      startTime: optionalString(row.start_time),
      duration: isNumber(row.duration) ? row.duration : null,
      createdAt,
      updatedAt: isNumber(row.updated_at) ? row.updated_at : createdAt,
    });
  }
  return { projects, entities, instances, malformed };
}

export interface ExistingProject {
  readonly id: string;
  readonly title: string;
  readonly workspaceRoot: string;
}

/** Where a group of wande projects lands. */
export type ProjectTarget =
  | {
      readonly type: "existing";
      readonly projectId: string;
      readonly title: string;
      readonly workspaceRoot: string;
      readonly matchedBy: "root" | "title";
    }
  | { readonly type: "create"; readonly title: string; readonly workspaceRoot: string }
  | { readonly type: "inbox" };

export interface PlannedGroup {
  readonly key: string;
  readonly target: ProjectTarget;
  /** Titles of the wande projects merged here; empty for tasks without a project. */
  readonly wandeProjects: ReadonlyArray<string>;
}

export interface PlannedTask {
  readonly id: TaskId;
  readonly wandeId: string;
  readonly wandeProjectId: string | null;
  readonly groupKey: string;
  readonly kind: TaskKind;
  readonly title: string;
  readonly description: string;
  readonly status: typeof PERSON_OPEN_STATUS | typeof PERSON_DONE_STATUS;
  readonly archived: boolean;
  readonly createdAt: string;
}

export interface PlannedEntry {
  readonly id: TaskScheduleEntryId;
  readonly taskId: TaskId;
  readonly date: string;
  readonly order: number;
  readonly startTime: string | null;
  readonly durationMinutes: number | null;
  readonly status: TaskScheduleEntryStatus;
  /** `id`: the instance names its task; `title`: an old instance matched by title. */
  readonly matchedBy: "id" | "title";
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WandePlan {
  readonly groups: ReadonlyArray<PlannedGroup>;
  /** Wande projects with no tasks or routines: nothing is created for them. */
  readonly skippedProjects: ReadonlyArray<string>;
  /** In import order: tasks, then routines, each by wande's order. */
  readonly tasks: ReadonlyArray<PlannedTask>;
  readonly entries: ReadonlyArray<PlannedEntry>;
  /** Tasks and routines naming a project the user does not have; they go to the Inbox. */
  readonly unknownProjectItems: number;
  /** Instances whose entity id no task or routine has, by title match outcome. */
  readonly history: { readonly matched: number; readonly ambiguous: number; readonly none: number };
  /** Instances skipped for an invalid date. */
  readonly invalidDates: number;
}

export const INBOX_GROUP = "inbox";

/** A wande title as a folder name: path separators become dashes. */
export function folderNameForTitle(title: string): string {
  const name = title.trim().replace(/[/\\]/g, "-");
  return name === "" || name === "." || name === ".." ? "Untitled project" : name;
}

const normalizeTitle = (title: string) => title.trim().toLowerCase();
const isScheduleDate = Schema.is(TaskScheduleDate);
const isScheduleTime = Schema.is(TaskScheduleTime);

const ENTITY_STATUS = {
  new: { status: PERSON_OPEN_STATUS, archived: false },
  done: { status: PERSON_DONE_STATUS, archived: false },
  // Archived tasks keep To Do, so unarchiving brings them back as wande's Restore does.
  archive: { status: PERSON_OPEN_STATUS, archived: true },
} as const;

const ENTRY_STATUS = { new: "open", done: "done", archived: "skipped" } as const;

export const wandeTaskId = (wandeId: string) => TaskId.make(`task-wande-${wandeId}`);
export const wandeEntryId = (wandeId: string) =>
  TaskScheduleEntryId.make(`task-schedule-entry-wande-${wandeId}`);

const byOrder = <T extends { order: number; createdAt: number; id: string }>(left: T, right: T) =>
  left.order - right.order || left.createdAt - right.createdAt || left.id.localeCompare(right.id);

/** HH:MM from wande's HH:MM or HH:MM:SS, or null. */
function scheduleTime(value: string | null): string | null {
  if (value === null) return null;
  const time = value.trim().slice(0, 5);
  return isScheduleTime(time) ? time : null;
}

/**
 * What the import creates. `rootFor` gives a wande project's folder (the
 * user's mapping, else the projects folder plus its title); an existing
 * project on that folder wins, then one with the same title.
 */
export function planWandeImport(input: {
  readonly data: WandeUserData;
  readonly existingProjects: ReadonlyArray<ExistingProject>;
  readonly rootFor: (title: string) => string;
}): WandePlan {
  const { data } = input;
  const used = new Set(data.entities.map(({ projectId }) => projectId));
  const groups = new Map<string, { target: ProjectTarget; wandeProjects: string[] }>();
  const groupOfProject = new Map<string, string>();
  const skippedProjects: string[] = [];
  // Active projects first, so a merged group is created with an active project's title.
  const projects = [...data.projects].sort(
    (left, right) =>
      Number(left.archived) - Number(right.archived) ||
      left.order - right.order ||
      left.id.localeCompare(right.id),
  );
  for (const project of projects) {
    if (!used.has(project.id)) {
      skippedProjects.push(project.title);
      continue;
    }
    const root = input.rootFor(project.title);
    const byRoot = input.existingProjects.find(({ workspaceRoot }) => workspaceRoot === root);
    const byTitle =
      byRoot ??
      input.existingProjects.find(
        ({ title }) => normalizeTitle(title) === normalizeTitle(project.title),
      );
    const existing = byRoot ?? byTitle;
    const key = existing ? `project:${existing.id}` : `root:${root}`;
    const target: ProjectTarget = existing
      ? {
          type: "existing",
          projectId: existing.id,
          title: existing.title,
          workspaceRoot: existing.workspaceRoot,
          matchedBy: byRoot ? "root" : "title",
        }
      : { type: "create", title: project.title.trim(), workspaceRoot: root };
    const group = groups.get(key) ?? { target, wandeProjects: [] };
    group.wandeProjects.push(project.title);
    groups.set(key, group);
    groupOfProject.set(project.id, key);
  }

  let unknownProjectItems = 0;
  const groupKeyOf = (entity: WandeEntity) => {
    if (entity.projectId === null) return INBOX_GROUP;
    const key = groupOfProject.get(entity.projectId);
    if (key !== undefined) return key;
    unknownProjectItems += 1;
    return INBOX_GROUP;
  };
  const ordered = [
    ...data.entities.filter(({ kind }) => kind === "task").sort(byOrder),
    ...data.entities.filter(({ kind }) => kind === "routine").sort(byOrder),
  ];
  const tasks = ordered.map((entity): PlannedTask => {
    const mapped = ENTITY_STATUS[entity.status];
    return {
      id: wandeTaskId(entity.id),
      wandeId: entity.id,
      wandeProjectId: entity.projectId,
      groupKey: groupKeyOf(entity),
      kind: entity.kind,
      title: entity.title,
      description: entity.content,
      status: mapped.status,
      archived: mapped.archived,
      createdAt: new Date(entity.createdAt).toISOString(),
    };
  });
  if (tasks.some(({ groupKey }) => groupKey === INBOX_GROUP)) {
    groups.set(INBOX_GROUP, { target: { type: "inbox" }, wandeProjects: [] });
  }

  const byId = new Map(data.entities.map((entity) => [entity.id, entity]));
  const byTitle = new Map<string, WandeEntity[]>();
  for (const entity of data.entities) {
    const key = `${entity.kind}:${normalizeTitle(entity.title)}`;
    byTitle.set(key, [...(byTitle.get(key) ?? []), entity]);
  }
  const history = { matched: 0, ambiguous: 0, none: 0 };
  let invalidDates = 0;
  const entries: PlannedEntry[] = [];
  for (const instance of [...data.instances].sort(byOrder)) {
    let entity = byId.get(instance.entityId);
    let matchedBy: PlannedEntry["matchedBy"] = "id";
    if (entity === undefined || entity.kind !== instance.kind) {
      const candidates = byTitle.get(`${instance.kind}:${normalizeTitle(instance.title)}`) ?? [];
      if (candidates.length !== 1) {
        if (candidates.length > 1) history.ambiguous += 1;
        else history.none += 1;
        continue;
      }
      history.matched += 1;
      entity = candidates[0]!;
      matchedBy = "title";
    }
    if (!isScheduleDate(instance.date)) {
      invalidDates += 1;
      continue;
    }
    entries.push({
      id: wandeEntryId(instance.id),
      taskId: wandeTaskId(entity.id),
      date: instance.date,
      order: instance.order,
      startTime: scheduleTime(instance.startTime),
      durationMinutes:
        instance.duration !== null &&
        Number.isInteger(instance.duration) &&
        instance.duration >= 1 &&
        instance.duration <= 1440
          ? instance.duration
          : null,
      status: ENTRY_STATUS[instance.status],
      matchedBy,
      createdAt: new Date(instance.createdAt).toISOString(),
      updatedAt: new Date(instance.updatedAt).toISOString(),
    });
  }

  return {
    groups: [...groups].map(([key, group]) => ({ key, ...group })),
    skippedProjects,
    tasks,
    entries,
    unknownProjectItems,
    history,
    invalidDates,
  };
}
