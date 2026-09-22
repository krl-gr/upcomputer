import { EDITORS, type EditorId } from "@upcomputer/contracts";

export type ContextOpenEditorActionId = `open.${EditorId}`;
export type ContextPreferredOpenActionId = "open.preferred";

export const CONTEXT_PREFERRED_OPEN_QUICK_ACTION_ID: ContextPreferredOpenActionId =
  "open.preferred";

export function contextOpenEditorActionId(editorId: EditorId): ContextOpenEditorActionId {
  return `open.${editorId}`;
}

const EDITOR_ID_SET = new Set<string>(EDITORS.map((editor) => editor.id));

export const DEFAULT_CONTEXT_QUICK_ACTION_IDS = ["git.quick", "rightPanel.toggle"] as const;

export const CONTEXT_NON_EDITOR_QUICK_ACTION_IDS = [
  "git.quick",
  "terminal.toggle",
  "diff.toggle",
  "rightPanel.toggle",
  "git.commit",
  "git.push",
  "git.pr",
  CONTEXT_PREFERRED_OPEN_QUICK_ACTION_ID,
] as const;

export type ContextNonEditorQuickActionId = (typeof CONTEXT_NON_EDITOR_QUICK_ACTION_IDS)[number];
export type ContextQuickActionId =
  | ContextNonEditorQuickActionId
  | ContextPreferredOpenActionId
  | ContextOpenEditorActionId;

export const CONTEXT_GIT_QUICK_ACTION_ORDER = [
  "git.quick",
  "git.commit",
  "git.push",
  "git.pr",
] as const satisfies ReadonlyArray<ContextNonEditorQuickActionId>;

export const CONTEXT_OPEN_EDITOR_QUICK_ACTION_ORDER = EDITORS.map((editor) =>
  contextOpenEditorActionId(editor.id),
);

export const CONTEXT_VIEW_QUICK_ACTION_ORDER = [
  "terminal.toggle",
  "diff.toggle",
  "rightPanel.toggle",
] as const satisfies ReadonlyArray<ContextNonEditorQuickActionId>;

const CONTEXT_NON_EDITOR_QUICK_ACTION_ID_SET = new Set<string>(CONTEXT_NON_EDITOR_QUICK_ACTION_IDS);

export function isContextOpenEditorActionId(value: unknown): value is ContextOpenEditorActionId {
  return (
    typeof value === "string" &&
    value.startsWith("open.") &&
    EDITOR_ID_SET.has(value.slice("open.".length))
  );
}

export function editorIdFromContextQuickActionId(value: ContextQuickActionId): EditorId | null {
  return isContextOpenEditorActionId(value) ? (value.slice("open.".length) as EditorId) : null;
}

export function isContextQuickActionId(value: unknown): value is ContextQuickActionId {
  return (
    (typeof value === "string" && CONTEXT_NON_EDITOR_QUICK_ACTION_ID_SET.has(value)) ||
    isContextOpenEditorActionId(value)
  );
}

export function sanitizeContextQuickActionIds(value: unknown): ContextQuickActionId[] {
  if (!Array.isArray(value)) return [...DEFAULT_CONTEXT_QUICK_ACTION_IDS];
  const nextIds: ContextQuickActionId[] = [];
  for (const entry of value) {
    if (isContextQuickActionId(entry) && !nextIds.includes(entry)) nextIds.push(entry);
  }
  return nextIds;
}

export function setContextQuickActionPinned(
  currentIds: readonly ContextQuickActionId[],
  actionId: ContextQuickActionId,
  pinned: boolean,
): ContextQuickActionId[] {
  const existingIds = currentIds.filter(isContextQuickActionId);
  if (pinned) return existingIds.includes(actionId) ? existingIds : [...existingIds, actionId];
  return existingIds.filter((id) => id !== actionId);
}
