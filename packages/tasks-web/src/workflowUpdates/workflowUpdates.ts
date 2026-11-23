import { useSyncExternalStore } from "react";

/*
 * DESIGN MOCK. Instruction updates as the UI reads them, served from sample data in
 * this browser. The real source is the server: replace this store, keep the shapes.
 * Switch scenarios from the console: `__instructionUpdatesDesign.set({ scenario: "several" })`.
 */

/** One piece of shipped text or settings an update changes, with both versions. */
export interface InstructionUpdateChange {
  readonly id: string;
  /** Where the text lives, as Settings names it. */
  readonly label: string;
  readonly before: string;
  readonly after: string;
}

export interface InstructionUpdateEntry {
  readonly id: string;
  readonly title: string;
  /** Names the brief file a chat gets. */
  readonly shortName: string;
  /** One line under the title. */
  readonly summary: string;
  readonly why: string;
  readonly release: string;
  readonly changes: ReadonlyArray<InstructionUpdateChange>;
  /** The steps the bot follows to apply it, part of the brief. */
  readonly steps: ReadonlyArray<string>;
  readonly state: "pending" | "applied";
  /** Who applied it and when, for an applied entry. */
  readonly appliedNote?: string;
  /** It changes text this user edited, so it never applies by itself. */
  readonly touchesEditedText?: boolean;
}

export type InstructionUpdateMode = "ask" | "auto";

export interface InstructionUpdates {
  readonly entries: ReadonlyArray<InstructionUpdateEntry>;
  readonly pending: ReadonlyArray<InstructionUpdateEntry>;
  /** The release's notification still shows in the bell. */
  readonly noticeShown: boolean;
  readonly mode: InstructionUpdateMode;
}

const RELEASE = "0.0.40";

const TASK_STATUSES: InstructionUpdateEntry = {
  id: "task-statuses",
  title: "We updated how task statuses work",
  shortName: "Task statuses update",
  summary: "New statuses, a new group order, and default instructions to match.",
  why: "Some status names could be read two ways. Backlog meant an idea for one person and a queued task for another, and Needs Input and Needs Review did not say what was needed from you. The new names say who acts next.",
  release: RELEASE,
  state: "pending",
  changes: [
    {
      id: "statuses",
      label: "Task statuses",
      before: [
        "Idea",
        "Backlog",
        "To Do",
        "In Progress",
        "In Review",
        "Needs Input",
        "Needs Review",
        "Blocked",
        "Done",
        "Cancelled",
      ].join("\n"),
      after: [
        "Idea",
        "Queued: approved, waiting in a worker's queue",
        "To Do",
        "In Progress",
        "In Review",
        "Needs You: was Needs Input",
        "Blocked",
        "Failed: set automatically when a worker run crashes",
        "To Verify: was Needs Review",
        "Done",
        "Cancelled",
      ].join("\n"),
    },
    {
      id: "groups",
      label: "Status group order",
      before: [
        "Needs Input",
        "Needs Review",
        "In Review",
        "In Progress",
        "To Do",
        "Backlog",
        "Blocked",
        "Idea",
        "Done",
        "Cancelled",
      ].join("\n"),
      after: [
        "Needs You",
        "Failed",
        "Blocked",
        "To Verify",
        "In Review",
        "In Progress",
        "To Do",
        "Queued",
        "Idea",
        "Done",
        "Cancelled",
      ].join("\n"),
    },
    {
      id: "task-execution",
      label: "Task execution instructions",
      before: [
        "Queue hand-off, before the final update: if no other task with your tag is in your start status or In Progress, move the bottom Backlog task with your tag to your start status.",
        "Pick the final status: Needs Review when the work is finished and nothing is open for the person; Needs Input when the person must answer something before the work can be finished; Blocked when you cannot continue for a technical reason.",
      ].join("\n"),
      after: [
        "Queue hand-off, before the final update: if no other task with your tag is in your start status or In Progress, move the bottom Queued task with your tag to your start status.",
        "Pick the final status: To Verify when the work is finished and nothing is open for the person; Needs You when the person must answer something before the work can be finished; Blocked when you cannot continue for a technical reason.",
        "Never set Failed yourself. Up.computer sets it when a run crashes.",
      ].join("\n"),
    },
  ],
  steps: [
    "Look at the statuses this person's tasks and workers use today, and at any instructions that name a status.",
    "Say what would change for them, and what you would keep as it is.",
    "After they agree: rename statuses on open tasks, update worker start statuses, then save the new instructions.",
  ],
};

// Sample entries for the several-pending state. Their wording is invented.
const QUEUE_HAND_OFF: InstructionUpdateEntry = {
  id: "queue-hand-off",
  title: "Workers hand off their queue one task at a time",
  shortName: "Queue hand-off update",
  summary: "A clearer rule for which queued task a worker starts next.",
  why: "Workers sometimes started two queued tasks at once after a long run.",
  release: RELEASE,
  state: "pending",
  changes: [
    {
      id: "agent-creation",
      label: "Worker creation instructions",
      before: "At the end of a run, move the next task in your queue to your start status.",
      after:
        "At the end of a run, move one task to your start status: the oldest one in your queue. Never more than one.",
    },
  ],
  steps: ["Check each worker's own instructions for a hand-off rule and update it."],
};

const SAVE_RULES: InstructionUpdateEntry = {
  id: "save-rules",
  title: "Agents ask before they save a rule",
  shortName: "Saving rules update",
  touchesEditedText: true,
  summary: "A preference you state in a chat is followed now and saved only when you say so.",
  why: "Agents saved one-off preferences as permanent instructions.",
  release: RELEASE,
  state: "pending",
  changes: [
    {
      id: "all-chats",
      label: "All chats instructions",
      before:
        "Save the user's preferences to the shared instructions when they are likely to matter again.",
      after:
        "Follow a preference the user states for the current work now; do not save it. If saving it seems useful, ask once in a short question, and write nothing until the user says yes.",
    },
  ],
  steps: [
    "Replace the paragraph in All chats. This person edited it, so show them both versions first.",
  ],
};

type Scenario = "none" | "one" | "several";

interface DesignState {
  readonly scenario: Scenario;
  readonly dismissed: boolean;
  readonly applied: ReadonlyArray<string>;
  readonly mode: InstructionUpdateMode;
}

const STORAGE_KEY = "upcomputer:instruction-updates-design:v1";
const DEFAULT_STATE: DesignState = { scenario: "one", dismissed: false, applied: [], mode: "ask" };

function load(): DesignState {
  try {
    const stored: unknown = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? "null");
    return stored && typeof stored === "object" ? { ...DEFAULT_STATE, ...stored } : DEFAULT_STATE;
  } catch {
    return DEFAULT_STATE;
  }
}

let state = load();
let snapshot = describe(state);
const listeners = new Set<() => void>();

function describe(current: DesignState): InstructionUpdates {
  const shipped =
    current.scenario === "none"
      ? []
      : current.scenario === "one"
        ? [TASK_STATUSES]
        : [TASK_STATUSES, QUEUE_HAND_OFF, SAVE_RULES];
  const entries = shipped.map((entry): InstructionUpdateEntry => {
    if (current.applied.includes(entry.id)) {
      return { ...entry, state: "applied", appliedNote: "Applied today with Penny" };
    }
    return current.mode === "auto" && !entry.touchesEditedText
      ? { ...entry, state: "applied", appliedNote: "Applied automatically today" }
      : entry;
  });
  const pending = entries.filter((entry) => entry.state === "pending");
  return {
    entries,
    pending,
    noticeShown: pending.length > 0 && !current.dismissed,
    mode: current.mode,
  };
}

function update(patch: Partial<DesignState>) {
  state = { ...state, ...patch };
  snapshot = describe(state);
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private windows keep the state for this page only.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const read = () => snapshot;

export function useInstructionUpdates(): InstructionUpdates {
  return useSyncExternalStore(subscribe, read, read);
}

export const dismissInstructionUpdatesNotice = () => update({ dismissed: true });
export const setInstructionUpdateMode = (mode: InstructionUpdateMode) => update({ mode });

if (typeof window !== "undefined") {
  Object.assign(window, {
    __instructionUpdatesDesign: { set: update, reset: () => update(DEFAULT_STATE) },
  });
}

/** The brief a chat gets as an attached file: what changed and why, both texts, the steps. */
export function instructionUpdatesBrief(entries: ReadonlyArray<InstructionUpdateEntry>): string {
  return entries
    .map((entry) =>
      [
        `# ${entry.title}`,
        "",
        `Up.computer ${entry.release}. ${entry.summary}`,
        "",
        `## Why`,
        "",
        entry.why,
        "",
        ...entry.changes.flatMap((change) => [
          `## ${change.label}`,
          "",
          "Before:",
          "",
          "```",
          change.before,
          "```",
          "",
          "After:",
          "",
          "```",
          change.after,
          "```",
          "",
        ]),
        "## How to apply",
        "",
        ...entry.steps.map((step, index) => `${index + 1}. ${step}`),
        "",
        "Change nothing until the user agrees.",
      ].join("\n"),
    )
    .join("\n\n---\n\n");
}

export function instructionUpdatesBriefName(
  entries: ReadonlyArray<InstructionUpdateEntry>,
): string {
  return entries.length === 1 && entries[0]
    ? `${entries[0].shortName}.md`
    : `${entries.length} instruction updates.md`;
}
