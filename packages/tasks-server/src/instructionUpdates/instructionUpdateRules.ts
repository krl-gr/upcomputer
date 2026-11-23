import {
  INSTRUCTION_UPDATES,
  isPendingInstructionUpdate,
  sameTaskStatus,
  type InstructionUpdateChange,
  type InstructionUpdateEntry,
  type InstructionUpdateState,
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

/**
 * Whole status names only: "Backlog" or "Needs input", not the word "backlog",
 * "BACKLOG.md" or "backlog_items".
 */
function statusPattern(status: string): RegExp {
  const words = status
    .trim()
    .split(/\s+/)
    .map((word, index) => {
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (index === 0) return escaped;
      return `[${word[0]?.toUpperCase()}${word[0]?.toLowerCase()}]${escaped.slice(1)}`;
    });
  return new RegExp(
    `(?<![\\p{L}\\p{N}_])${words.join("\\s+")}(?![\\p{L}\\p{N}_]|\\.[\\p{L}\\p{N}])`,
    "u",
  );
}

function namedStatuses(text: string, statuses: ReadonlyArray<string>): string[] {
  return statuses.filter((status) => statusPattern(status).test(text));
}

type PromptChange = Extract<InstructionUpdateChange, { kind: "prompt" }>;

/** Entry id to its state on this install. */
export type InstructionUpdateStates = ReadonlyMap<string, InstructionUpdateState>;

/**
 * Where a field's text stands for an entry. A default an earlier entry ships
 * from (the 0.0.39 text, say) is not edited: the entry waits for that earlier
 * one while it is pending. Once it was kept or applied, that text is the user's.
 */
function promptTextOf(
  entry: InstructionUpdateEntry,
  change: PromptChange,
  texts: UserTexts,
  states: InstructionUpdateStates,
): { readonly kind: "shipped" | "edited" } | { readonly kind: "waits"; readonly on: string } {
  const { field } = change;
  const current = texts.prompts[field];
  if (current === change.before || current === change.after) return { kind: "shipped" };
  const earlier = INSTRUCTION_UPDATES.slice(
    0,
    INSTRUCTION_UPDATES.findIndex((item) => item.id === entry.id),
  ).find((item) =>
    item.changes.some(
      (other) => other.kind === "prompt" && other.field === field && other.before === current,
    ),
  );
  const state = earlier === undefined ? undefined : states.get(earlier.id);
  return earlier !== undefined && state !== undefined && isPendingInstructionUpdate(state)
    ? { kind: "waits", on: earlier.id }
    : { kind: "edited" };
}

/** The pending earlier entry this one waits for, when its texts are still that entry's defaults. */
export function waitsForOf(
  entry: InstructionUpdateEntry,
  texts: UserTexts,
  states: InstructionUpdateStates,
): string | undefined {
  for (const change of entry.changes) {
    if (change.kind !== "prompt") continue;
    const text = promptTextOf(entry, change, texts, states);
    if (text.kind === "waits") return text.on;
  }
  return undefined;
}

/**
 * The texts an entry would change that the user wrote or edited. Shipped
 * defaults the user left alone are not counted: replacing those is the update.
 */
export function editedTextOf(
  entry: InstructionUpdateEntry,
  texts: UserTexts,
  states: InstructionUpdateStates,
): EditedText {
  const editedFields: TaskPromptField[] = [];
  for (const change of entry.changes) {
    if (change.kind !== "prompt") continue;
    if (promptTextOf(entry, change, texts, states).kind === "edited")
      editedFields.push(change.field);
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

/**
 * A saved group order as the entry ships it: renamed keys keep their places, and
 * groups the entry adds go right after the group before them in its new order,
 * since the Tasks list puts unsaved keys below every saved one. An empty order
 * follows the default and stays empty.
 */
export function shippedGroupOrder(
  saved: ReadonlyArray<string>,
  entry: InstructionUpdateEntry,
): string[] {
  const renames = entry.statusRenames ?? {};
  const order = saved.map((key) => renamedGroupKey(key, renames));
  const change = entry.changes.find((item) => item.kind === "groupOrder");
  if (order.length === 0 || change?.kind !== "groupOrder") return order;
  const before = new Set(change.before.map((status) => renamedGroupKey(groupKey(status), renames)));
  const after = change.after.map(groupKey);
  after.forEach((key, index) => {
    if (before.has(key) || order.includes(key)) return;
    const previous = after.slice(0, index).findLast((earlier) => order.includes(earlier));
    order.splice(previous === undefined ? 0 : order.indexOf(previous) + 1, 0, key);
  });
  return order;
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
