import {
  ASSISTANT_CITATION_MAX_ID_LENGTH,
  ASSISTANT_CITATION_MAX_TEXT_LENGTH,
  ASSISTANT_CITATION_TASK_TITLE_LENGTH,
  EnvironmentId,
  TaskOutputCitation,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import { splitsSurrogatePair } from "@t3tools/shared/assistantCitations";
import { TaskId, TaskKind } from "@t3tools/tasks-contracts/v1";
import { Option, Schema } from "effect";
import { type RefObject, useEffect, useEffectEvent } from "react";

import { formatAssistantCitationForComposer } from "../../composer-logic";
import { isInsideRestingComposerControlScope } from "./composerEventScope";

export const COMPOSER_TASK_DRAG_TYPE = "application/x-t3code-task";

const TASK_CITATION_MAX_ID_LENGTH = 512;

export const ComposerTaskDragData = Schema.Struct({
  environmentId: EnvironmentId.check(Schema.isMaxLength(ASSISTANT_CITATION_MAX_ID_LENGTH)),
  taskId: TaskId.check(Schema.isMaxLength(TASK_CITATION_MAX_ID_LENGTH)),
  title: TrimmedNonEmptyString,
  kind: TaskKind,
});
export type ComposerTaskDragData = typeof ComposerTaskDragData.Type;

const TaskDragPayload = Schema.fromJsonString(ComposerTaskDragData);
const decodeTaskDragData = Schema.decodeOption(ComposerTaskDragData);
const decodeTaskOutputCitation = Schema.decodeOption(TaskOutputCitation);

export const encodeTaskDragPayload = Schema.encodeSync(TaskDragPayload);
export const decodeTaskDragPayload = Schema.decodeUnknownOption(TaskDragPayload);

export interface ComposerTaskDragInput {
  readonly environmentId: EnvironmentId;
  readonly taskId: TaskId;
  readonly title: string;
  readonly kind: TaskKind;
}

function clipPreservingSurrogatePair(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const end = splitsSurrogatePair(value, maxLength) ? maxLength - 1 : maxLength;
  return value.slice(0, end);
}

export function buildComposerTaskDragData(
  input: ComposerTaskDragInput,
): ComposerTaskDragData | null {
  const title = input.title.trim();
  if (title.length === 0) return null;
  return Option.getOrNull(
    decodeTaskDragData({
      environmentId: input.environmentId,
      taskId: input.taskId,
      title,
      kind: input.kind,
    }),
  );
}

export function setComposerTaskDragData(
  dataTransfer: { setData?: (format: string, data: string) => void } | null | undefined,
  input: ComposerTaskDragInput,
): boolean {
  if (typeof dataTransfer?.setData !== "function") return false;
  const payload = buildComposerTaskDragData(input);
  if (!payload) return false;
  dataTransfer.setData(COMPOSER_TASK_DRAG_TYPE, encodeTaskDragPayload(payload));
  return true;
}

export function taskDragCitation(task: ComposerTaskDragData): TaskOutputCitation | null {
  const title = task.title.trim();
  const text = clipPreservingSurrogatePair(title, ASSISTANT_CITATION_MAX_TEXT_LENGTH);
  return Option.getOrNull(
    decodeTaskOutputCitation({
      version: 1,
      environmentId: task.environmentId,
      taskId: task.taskId,
      taskTitle: clipPreservingSurrogatePair(title, ASSISTANT_CITATION_TASK_TITLE_LENGTH),
      text,
      start: 0,
      end: text.length,
      prefix: "",
      suffix: "",
    }),
  );
}

export function formatComposerTaskQuote(task: ComposerTaskDragData): string | null {
  const citation = taskDragCitation(task);
  return citation ? formatAssistantCitationForComposer(citation) : null;
}

const COMPOSER_TASK_DROP_EVENT = "t3-composer-task-drop";
const COMPOSER_TASK_DRAG_OVER_EVENT = "t3-composer-task-drag-over";

const DROP_TARGET_ATTRIBUTE = "data-composer-task-drop";
export const COMPOSER_TASK_DRAG_OVERLAY_ATTRIBUTE = "data-composer-task-drag-overlay";

export function composerTaskDropTargetProps() {
  return { [DROP_TARGET_ATTRIBUTE]: "true" } as const;
}

function findComposerTaskDropTarget(point: { x: number; y: number }): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const hit =
    typeof document.elementsFromPoint === "function"
      ? document.elementsFromPoint(point.x, point.y)
      : [document.elementFromPoint(point.x, point.y)].filter(
          (element): element is Element => element !== null,
        );
  for (const element of hit) {
    if (element.closest(`[${COMPOSER_TASK_DRAG_OVERLAY_ATTRIBUTE}]`) !== null) continue;
    if (element.closest("[inert]") !== null) return null;
    if (isInsideRestingComposerControlScope(element)) return null;
    const target = element.closest<HTMLElement>(`[${DROP_TARGET_ATTRIBUTE}]`);
    return target && target.closest("[inert]") === null ? target : null;
  }
  return null;
}

let overTarget: HTMLElement | null = null;

function dispatchDragOver(target: HTMLElement, active: boolean) {
  target.dispatchEvent(new CustomEvent<boolean>(COMPOSER_TASK_DRAG_OVER_EVENT, { detail: active }));
}

export function moveComposerTaskDrag(point: { x: number; y: number }): boolean {
  const target = findComposerTaskDropTarget(point);
  if (target !== overTarget) {
    if (overTarget) dispatchDragOver(overTarget, false);
    if (target) dispatchDragOver(target, true);
    overTarget = target;
  }
  return target !== null;
}

export function endComposerTaskDrag(): void {
  if (!overTarget) return;
  dispatchDragOver(overTarget, false);
  overTarget = null;
}

export function dropComposerTask(
  point: { x: number; y: number },
  tasks: ReadonlyArray<ComposerTaskDragData>,
): boolean {
  const target = findComposerTaskDropTarget(point);
  endComposerTaskDrag();
  if (!target || tasks.length === 0) return false;
  const encoded = tasks.map((task) => encodeTaskDragPayload(task));
  target.dispatchEvent(
    new CustomEvent<ReadonlyArray<string>>(COMPOSER_TASK_DROP_EVENT, { detail: encoded }),
  );
  return true;
}

export function useComposerTaskDrop(
  targetRef: RefObject<EventTarget | null>,
  handlers: {
    readonly onDragOver: (active: boolean) => void;
    readonly onDropTasks: (tasks: ReadonlyArray<ComposerTaskDragData>) => boolean;
    readonly onInsertRejected: () => void;
  },
) {
  const handleDragOver = useEffectEvent(handlers.onDragOver);
  const handleDropTasks = useEffectEvent(handlers.onDropTasks);
  const handleInsertRejected = useEffectEvent(handlers.onInsertRejected);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes the composer form to pointer-driven task drop events from the planner
  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    const onOver = (event: Event) => {
      handleDragOver((event as CustomEvent<boolean>).detail === true);
    };
    const onDrop = (event: Event) => {
      handleDragOver(false);
      const raw = (event as CustomEvent<ReadonlyArray<string>>).detail;
      if (!Array.isArray(raw)) return;
      const decoded: ComposerTaskDragData[] = [];
      for (const entry of raw) {
        const parsed = decodeTaskDragPayload(entry);
        if (Option.isSome(parsed)) decoded.push(parsed.value);
      }
      if (decoded.length > 0 && !handleDropTasks(decoded)) {
        handleInsertRejected();
      }
    };
    target.addEventListener(COMPOSER_TASK_DRAG_OVER_EVENT, onOver);
    target.addEventListener(COMPOSER_TASK_DROP_EVENT, onDrop);
    return () => {
      target.removeEventListener(COMPOSER_TASK_DRAG_OVER_EVENT, onOver);
      target.removeEventListener(COMPOSER_TASK_DROP_EVENT, onDrop);
    };
  }, [targetRef]);
}
