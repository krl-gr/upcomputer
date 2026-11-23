import {
  sameTaskStatus,
  type InstructionUpdateEntry,
  type TaskPromptField,
  type TaskPromptSettings,
} from "@t3tools/tasks-contracts/v1";

/** An install that already runs the entry's workflow had it from the start. */
export function appliedAtInstall(entry: InstructionUpdateEntry, workflowVersion: number): boolean {
  return entry.workflowVersion !== undefined && workflowVersion >= entry.workflowVersion;
}

/** What of the user's own text applying an entry would have to change. */
export interface EditedText {
  /** Global fields whose text is neither the entry's before nor its after. */
  readonly editedFields: ReadonlyArray<TaskPromptField>;
  /** User-written texts that name a status the entry renames. */
  readonly mentions: ReadonlyArray<{
    readonly where: "allChats" | "project" | "worker";
    readonly id?: string;
    readonly name?: string;
    readonly statuses: ReadonlyArray<string>;
  }>;
}

export interface UserTexts {
  readonly prompts: TaskPromptSettings;
  readonly allChats: string;
  readonly projects: ReadonlyArray<{ readonly id: string; readonly settings: TaskPromptSettings }>;
  readonly workers: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly instructions: string;
  }>;
}

function namedStatuses(text: string, statuses: ReadonlyArray<string>): string[] {
  return statuses.filter((status) =>
    new RegExp(
      `(^|[^\\p{L}\\p{N}])${status.replace(/\s+/g, "\\s+")}($|[^\\p{L}\\p{N}])`,
      "iu",
    ).test(text),
  );
}

/**
 * The texts an entry would change that the user wrote or edited. Shipped
 * defaults the user left alone are not counted: replacing those is the update.
 */
export function editedTextOf(entry: InstructionUpdateEntry, texts: UserTexts): EditedText {
  const editedFields: TaskPromptField[] = [];
  for (const change of entry.changes) {
    if (change.kind !== "prompt") continue;
    const current = texts.prompts[change.field];
    if (current !== change.before && current !== change.after) editedFields.push(change.field);
  }
  const old = Object.keys(entry.statusRenames ?? {});
  const mentions: Array<EditedText["mentions"][number]> = [];
  if (old.length > 0) {
    const allChats = namedStatuses(texts.allChats, old);
    if (allChats.length > 0) mentions.push({ where: "allChats", statuses: allChats });
    for (const project of texts.projects) {
      const statuses = namedStatuses(Object.values(project.settings).join("\n"), old);
      if (statuses.length > 0) mentions.push({ where: "project", id: project.id, statuses });
    }
    for (const worker of texts.workers) {
      const statuses = namedStatuses(worker.instructions, old);
      if (statuses.length > 0)
        mentions.push({ where: "worker", id: worker.id, name: worker.name, statuses });
    }
  }
  return { editedFields, mentions };
}

export const touchesEditedText = (edited: EditedText) =>
  edited.editedFields.length > 0 || edited.mentions.length > 0;

/** A saved group order or open-groups key, renamed the way the entry renames statuses. */
export function renamedGroupKey(key: string, renames: Readonly<Record<string, string>>): string {
  for (const [from, to] of Object.entries(renames)) {
    if (key === groupKey(from)) return groupKey(to);
  }
  return key;
}

/** As the Tasks list keys its groups (statusGroupKey in tasks-web). */
const groupKey = (status: string) => status.trim().toLowerCase();

/** A start-status list with the entry's renames, keeping order and dropping repeats. */
export function renamedStatuses(
  statuses: ReadonlyArray<string>,
  renames: Readonly<Record<string, string>>,
): string[] {
  const renamed = statuses.map(
    (status) =>
      Object.entries(renames).find(([from]) => sameTaskStatus(from, status))?.[1] ?? status,
  );
  return renamed.filter(
    (status, index) => renamed.findIndex((other) => sameTaskStatus(other, status)) === index,
  );
}
