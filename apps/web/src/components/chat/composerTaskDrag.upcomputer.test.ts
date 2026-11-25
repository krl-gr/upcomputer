import {
  ASSISTANT_CITATION_MAX_ID_LENGTH,
  ASSISTANT_CITATION_TASK_TITLE_LENGTH,
  EnvironmentId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import { collectAssistantCitations } from "@t3tools/shared/assistantCitations";
import { TaskId } from "@t3tools/tasks-contracts/v1";
import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import { Option } from "effect";

import {
  type ComposerMentionDropHost,
  dataTransferHasComposerMention,
  makeComposerMentionDragHandlers,
} from "./composerMentionDrag.ts";
import {
  buildComposerTaskDragData,
  COMPOSER_TASK_DRAG_OVERLAY_ATTRIBUTE,
  COMPOSER_TASK_DRAG_TYPE,
  type ComposerTaskDragData,
  composerTaskDropTargetProps,
  decodeTaskDragPayload,
  dropComposerTask,
  encodeTaskDragPayload,
  endComposerTaskDrag,
  formatComposerTaskQuote,
  moveComposerTaskDrag,
  taskDragCitation,
} from "./composerTaskDrag.ts";

const ENV_ID = EnvironmentId.make("env-remote");
const TASK_ID = TaskId.make("task-123");

const sampleTask = (overrides: Partial<ComposerTaskDragData> = {}): ComposerTaskDragData => ({
  environmentId: ENV_ID,
  taskId: TASK_ID,
  title: TrimmedNonEmptyString.make("Ship task drag quote"),
  kind: "task",
  ...overrides,
});

const makeTaskDragEvent = (
  payload: string,
  types: ReadonlyArray<string> = [COMPOSER_TASK_DRAG_TYPE],
) => {
  const calls: Array<string> = [];
  const event = {
    dataTransfer: {
      types,
      getData: (requested: string) => (requested === COMPOSER_TASK_DRAG_TYPE ? payload : ""),
      dropEffect: "none",
    },
    nativeEvent: {
      stopPropagation: () => void calls.push("nativeStopPropagation"),
    },
    preventDefault: () => void calls.push("preventDefault"),
    stopPropagation: () => void calls.push("stopPropagation"),
  };
  return { event, calls };
};

const makeHost = (insertResult = true) => {
  const log: Array<string> = [];
  const insertedTasks: Array<ComposerTaskDragData> = [];
  const host: ComposerMentionDropHost = {
    insertMentionAtEnd: (text) => {
      log.push(`mention:${text}`);
      return insertResult;
    },
    insertPullRequestAtEnd: (pullRequest) => {
      log.push(`pr:${pullRequest.number}`);
      return insertResult;
    },
    insertTaskAtEnd: (task) => {
      insertedTasks.push(task);
      log.push(`task:${task.taskId}`);
      return insertResult;
    },
    setDragActive: (active) => void log.push(`active:${active}`),
    onInsertRejected: () => void log.push("rejected"),
  };
  return { host, log, insertedTasks };
};

class FakeElement extends EventTarget {
  readonly attributes: Record<string, string>;
  readonly parent: FakeElement | null;

  constructor(attributes: Record<string, string> = {}, parent: FakeElement | null = null) {
    super();
    this.attributes = attributes;
    this.parent = parent;
  }

  private matchesSelector(selector: string): boolean {
    const match = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
    if (!match || !match[1]) return false;
    const [, name, expected] = match;
    if (!(name in this.attributes)) return false;
    return expected === undefined || this.attributes[name] === expected;
  }

  closest(selector: string): FakeElement | null {
    for (let current: FakeElement | null = this; current !== null; current = current.parent) {
      if (current.matchesSelector(selector)) return current;
    }
    return null;
  }
}

describe("composer task drag payload", () => {
  it.each([
    { name: "worker or planner task", payload: sampleTask() },
    {
      name: "routine",
      payload: sampleTask({
        taskId: TaskId.make("routine-7"),
        title: TrimmedNonEmptyString.make("Morning triage"),
        kind: "routine",
      }),
    },
  ])("round-trips $name through JSON schema encoding", ({ payload }) => {
    const encoded = encodeTaskDragPayload(payload);
    const decoded = decodeTaskDragPayload(encoded);
    expect(Option.isSome(decoded)).toBe(true);
    expect(Option.getOrNull(decoded)).toEqual(payload);
  });

  it.each([
    "not-json",
    JSON.stringify({}),
    JSON.stringify({ ...sampleTask(), title: "   " }),
    JSON.stringify({ ...sampleTask(), kind: "automation" }),
    JSON.stringify({ ...sampleTask(), taskId: "" }),
    JSON.stringify({ ...sampleTask(), taskId: "t".repeat(513) }),
    JSON.stringify({
      ...sampleTask(),
      environmentId: "e".repeat(ASSISTANT_CITATION_MAX_ID_LENGTH + 1),
    }),
  ])("rejects invalid or oversized payload: %s", (raw) => {
    expect(Option.isNone(decodeTaskDragPayload(raw))).toBe(true);
  });

  it("buildComposerTaskDragData trims titles and rejects blank or oversized ids", () => {
    expect(
      buildComposerTaskDragData({
        environmentId: ENV_ID,
        taskId: TASK_ID,
        title: "  Trim me  ",
        kind: "task",
      })?.title,
    ).toBe("Trim me");
    expect(
      buildComposerTaskDragData({
        environmentId: ENV_ID,
        taskId: TASK_ID,
        title: "   ",
        kind: "task",
      }),
    ).toBeNull();
    expect(
      buildComposerTaskDragData({
        environmentId: ENV_ID,
        taskId: TaskId.make("t".repeat(513)),
        title: "Too long id",
        kind: "task",
      }),
    ).toBeNull();
  });

  it("formats a dropped task as a round-tripping TaskOutputCitation without splitting surrogate pairs", () => {
    const emojiTitle = `${"a".repeat(ASSISTANT_CITATION_TASK_TITLE_LENGTH - 1)}😀tail`;
    const task = sampleTask({ title: TrimmedNonEmptyString.make(emojiTitle) });
    const citation = taskDragCitation(task);
    expect(citation).not.toBeNull();
    expect(citation!.taskTitle).toHaveLength(ASSISTANT_CITATION_TASK_TITLE_LENGTH - 1);
    expect(citation!.taskTitle.endsWith("\ud83d")).toBe(false);
    expect(citation!.prefix).toBe("");
    expect(citation!.suffix).toBe("");
    expect(citation!.start).toBe(0);
    expect(citation!.end).toBe(citation!.text.length);
    expect(citation!.comment).toBeUndefined();

    const formatted = formatComposerTaskQuote(sampleTask());
    expect(formatted).not.toBeNull();
    expect(formatted!.endsWith(" ")).toBe(true);
    const collected = collectAssistantCitations(formatted!);
    expect(collected).toHaveLength(1);
    expect(collected[0]?.citation).toEqual(taskDragCitation(sampleTask()));
  });
});

describe("composer mention drag handlers for tasks", () => {
  it("accepts task drag MIME type and sets move dropEffect", () => {
    expect(dataTransferHasComposerMention([COMPOSER_TASK_DRAG_TYPE])).toBe(true);
    const { host, log } = makeHost();
    const handlers = makeComposerMentionDragHandlers(host);
    const { event, calls } = makeTaskDragEvent(encodeTaskDragPayload(sampleTask()));

    handlers.onDragEnter(event);
    handlers.onDragOver(event);
    expect(event.dataTransfer.dropEffect).toBe("move");
    expect(calls).toContain("preventDefault");
    expect(calls).toContain("stopPropagation");
    expect(calls).toContain("nativeStopPropagation");
    expect(log).toEqual(["active:true", "active:true"]);
  });

  it("decodes and inserts the dropped task and clears drag highlight", () => {
    const { host, log, insertedTasks } = makeHost(true);
    const handlers = makeComposerMentionDragHandlers(host);
    const payload = sampleTask();
    const { event } = makeTaskDragEvent(encodeTaskDragPayload(payload));

    handlers.onDrop(event);
    expect(insertedTasks).toEqual([payload]);
    expect(log).toEqual(["active:false", `task:${payload.taskId}`]);
  });

  it("notifies host when task insertion is rejected", () => {
    const { host, log } = makeHost(false);
    const handlers = makeComposerMentionDragHandlers(host);
    const payload = sampleTask();
    const { event } = makeTaskDragEvent(encodeTaskDragPayload(payload));

    handlers.onDrop(event);
    expect(log).toEqual(["active:false", `task:${payload.taskId}`, "rejected"]);
  });

  it("ignores malformed or oversized task payloads without inserting or rejecting", () => {
    const { host, log, insertedTasks } = makeHost(true);
    const handlers = makeComposerMentionDragHandlers(host);

    handlers.onDrop(makeTaskDragEvent("{bad json").event);
    handlers.onDrop(
      makeTaskDragEvent(JSON.stringify({ ...sampleTask(), taskId: "x".repeat(600) })).event,
    );
    expect(insertedTasks).toEqual([]);
    expect(log).toEqual(["active:false", "active:false"]);
  });
});

describe("composer task pointer drop bridge", () => {
  afterEach(() => {
    endComposerTaskDrag();
    vi.unstubAllGlobals();
  });

  const makeComposerTarget = (parent: FakeElement | null = null) => {
    const form = new FakeElement({ ...composerTaskDropTargetProps() }, parent);
    const editor = new FakeElement({}, form);
    const events: Array<{ type: string; detail: unknown }> = [];
    form.addEventListener("t3-composer-task-drag-over", (event) => {
      events.push({ type: "over", detail: (event as CustomEvent).detail });
    });
    form.addEventListener("t3-composer-task-drop", (event) => {
      events.push({ type: "drop", detail: (event as CustomEvent).detail });
    });
    return { form, editor, events };
  };

  it("skips drag overlay, highlights composer target, drops encoded tasks, and cleans up on end", () => {
    const { editor, events } = makeComposerTarget();
    const overlay = new FakeElement({ [COMPOSER_TASK_DRAG_OVERLAY_ATTRIBUTE]: "" });
    const overlayChild = new FakeElement({}, overlay);

    vi.stubGlobal("Element", FakeElement);
    vi.stubGlobal("document", {
      elementsFromPoint: () => [overlayChild, editor],
    });

    expect(moveComposerTaskDrag({ x: 10, y: 10 })).toBe(true);
    expect(events).toEqual([{ type: "over", detail: true }]);

    const task = sampleTask();
    expect(dropComposerTask({ x: 10, y: 10 }, [task])).toBe(true);
    expect(events).toEqual([
      { type: "over", detail: true },
      { type: "over", detail: false },
      { type: "drop", detail: [encodeTaskDragPayload(task)] },
    ]);

    expect(moveComposerTaskDrag({ x: 10, y: 10 })).toBe(true);
    endComposerTaskDrag();
    expect(events.at(-1)).toEqual({ type: "over", detail: false });
  });

  it("rejects composer targets inside an inert subtree or resting composer controls", () => {
    const inertWrapper = new FakeElement({ inert: "" });
    const { editor: inertEditor, events: inertEvents } = makeComposerTarget(inertWrapper);

    const { form: liveForm, events: liveEvents } = makeComposerTarget();
    const resting = new FakeElement({ "data-chat-composer-resting-controls": "true" }, liveForm);

    let hit: FakeElement[] = [inertEditor];
    vi.stubGlobal("Element", FakeElement);
    vi.stubGlobal("document", {
      elementsFromPoint: () => hit,
    });

    expect(moveComposerTaskDrag({ x: 5, y: 5 })).toBe(false);
    expect(dropComposerTask({ x: 5, y: 5 }, [sampleTask()])).toBe(false);
    expect(inertEvents).toEqual([]);

    hit = [resting, liveForm];
    expect(moveComposerTaskDrag({ x: 5, y: 5 })).toBe(false);
    expect(dropComposerTask({ x: 5, y: 5 }, [sampleTask()])).toBe(false);
    expect(liveEvents).toEqual([]);
  });
});
