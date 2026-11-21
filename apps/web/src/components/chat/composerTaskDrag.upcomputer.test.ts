import {
  ASSISTANT_CITATION_TASK_TITLE_LENGTH,
  EnvironmentId,
  ProjectId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import { collectAssistantCitations } from "@t3tools/shared/assistantCitations";
import { TaskId } from "@t3tools/tasks-contracts/v1";
import { describe, expect, it } from "@effect/vitest";
import { Option } from "effect";

import {
  type ComposerMentionDropHost,
  dataTransferHasComposerMention,
  makeComposerMentionDragHandlers,
} from "./composerMentionDrag.ts";
import {
  buildComposerTaskDragData,
  COMPOSER_TASK_DRAG_TYPE,
  type ComposerTaskDragData,
  decodeTaskDragPayload,
  encodeTaskDragPayload,
  formatComposerTaskQuote,
  taskDragCitation,
} from "./composerTaskDrag.ts";

const ENV_ID = EnvironmentId.make("env-remote");
const PROJECT_ID = ProjectId.make("project-1");
const TASK_ID = TaskId.make("task-123");

const sampleTask = (overrides: Partial<ComposerTaskDragData> = {}): ComposerTaskDragData => ({
  environmentId: ENV_ID,
  taskId: TASK_ID,
  title: TrimmedNonEmptyString.make("Ship task drag quote"),
  kind: "task",
  projectId: PROJECT_ID,
  projectName: "UpComputer",
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

describe("composer task drag payload", () => {
  it.each([
    { name: "worker or planner task", payload: sampleTask() },
    {
      name: "routine without project metadata",
      payload: sampleTask({
        taskId: TaskId.make("routine-7"),
        title: TrimmedNonEmptyString.make("Morning triage"),
        kind: "routine",
        projectId: null,
        projectName: null,
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
  ])("rejects invalid payload: %s", (raw) => {
    expect(Option.isNone(decodeTaskDragPayload(raw))).toBe(true);
  });

  it("buildComposerTaskDragData trims titles and rejects blank titles", () => {
    expect(
      buildComposerTaskDragData({
        environmentId: ENV_ID,
        taskId: TASK_ID,
        title: "  Trim me  ",
        kind: "task",
        projectId: PROJECT_ID,
        projectName: "UpComputer",
      })?.title,
    ).toBe("Trim me");
    expect(
      buildComposerTaskDragData({
        environmentId: ENV_ID,
        taskId: TASK_ID,
        title: "   ",
        kind: "task",
        projectId: PROJECT_ID,
        projectName: "UpComputer",
      }),
    ).toBeNull();
  });

  it("formats a dropped task as a round-tripping TaskOutputCitation", () => {
    const longTitle = "x".repeat(ASSISTANT_CITATION_TASK_TITLE_LENGTH + 25);
    const task = sampleTask({ title: TrimmedNonEmptyString.make(longTitle) });
    const citation = taskDragCitation(task);
    expect(citation.taskTitle).toHaveLength(ASSISTANT_CITATION_TASK_TITLE_LENGTH);
    expect(citation.prefix).toBe("");
    expect(citation.suffix).toBe("");
    expect(citation.start).toBe(0);
    expect(citation.end).toBe(citation.text.length);
    expect(citation.comment).toBeUndefined();

    const formatted = formatComposerTaskQuote(sampleTask());
    expect(formatted.endsWith(" ")).toBe(true);
    const collected = collectAssistantCitations(formatted);
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

  it("ignores malformed task payloads without inserting or rejecting", () => {
    const { host, log, insertedTasks } = makeHost(true);
    const handlers = makeComposerMentionDragHandlers(host);
    const { event } = makeTaskDragEvent("{bad json");

    handlers.onDrop(event);
    expect(insertedTasks).toEqual([]);
    expect(log).toEqual(["active:false"]);
  });
});
