import {
  defaultTaskPromptSettings,
  EMPTY_TASK_PROMPT_SETTINGS,
  LEGACY_TASK_WORKFLOW_VERSION,
  taskWorkflowVersionOf,
  type InstructionsField,
  type TaskPromptSettings,
  type TaskWorkflowVersion,
} from "@t3tools/tasks-contracts/v1";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  CUSTOM_INSTRUCTIONS_MAX_CHARS,
  DEFAULT_CUSTOM_INSTRUCTIONS,
  DEFAULT_SERVER_SETTINGS,
  type EnvironmentId,
} from "@t3tools/contracts";
import { useBlocker } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { msg, T, useGT, useMessages, Var } from "gt-react";

import { Button } from "../../../../apps/web/src/components/ui/button.tsx";
import { toastManager } from "../../../../apps/web/src/components/ui/toast.tsx";
import { SettingsGroup } from "../../../../apps/web/src/components/settings/SettingsGroup.tsx";
import { useSettingsScope } from "../../../../apps/web/src/components/settings/SettingsScopeContext.tsx";
import { SettingsPageContainer } from "../../../../apps/web/src/components/settings/settingsLayout.tsx";
import { cn } from "../../../../apps/web/src/lib/utils.ts";
import { ensureLocalApi } from "../../../../apps/web/src/localApi.ts";
import { useServerConfigs } from "../../../../apps/web/src/state/entities.ts";
import { serverEnvironment } from "../../../../apps/web/src/state/server.ts";
import { useAtomCommand } from "../../../../apps/web/src/state/use-atom-command.ts";
import {
  readTasksWebAccess,
  readTasksWebClient,
  useTasksWebAccessRevision,
} from "../environmentApi.ts";
import {
  type AllChatsDraft,
  type PromptDrafts,
  draftAfterSave,
  instructionsSaveInput,
  promptsAfterReload,
} from "./instructionsSave.ts";
import { LazyMarkdownEditor } from "../markdown/LazyMarkdownEditor.tsx";
import { InstructionUpdatesSection } from "../workflowUpdates/InstructionUpdatesSection.tsx";

// "All chats" edits the core `customInstructions` setting, which every agent
// harness adds to its prompt. The other tabs edit the Tasks prompt settings.
const ALL_CHATS_TAB = { id: "allChats", label: msg("All chats") } as const;

const PROMPT_TABS = [
  {
    id: "taskCreation",
    label: msg("Task creation"),
    globalNote: msg("Global task creation instructions, which come first"),
  },
  {
    id: "agentCreation",
    label: msg("Worker creation"),
    globalNote: msg("Global worker creation instructions, which come first"),
  },
  {
    id: "automationCreation",
    label: msg("Automation creation"),
    globalNote: msg("Global automation creation instructions, which come first"),
  },
  {
    id: "taskExecution",
    label: msg("Task execution"),
    globalNote: msg("Global task execution instructions, which come first"),
  },
] as const;

const TABS = [ALL_CHATS_TAB, ...PROMPT_TABS] as const;

type TabId = (typeof TABS)[number]["id"];

/** Global texts restore to the install's workflow defaults; project additions clear. */
function promptDefaultsFor(
  project: object | null,
  workflowVersion: TaskWorkflowVersion,
): TaskPromptSettings {
  return project === null ? defaultTaskPromptSettings(workflowVersion) : EMPTY_TASK_PROMPT_SETTINGS;
}

function sameSettings(left: TaskPromptSettings, right: TaskPromptSettings): boolean {
  return PROMPT_TABS.every(({ id }) => left[id] === right[id]);
}

type GT = ReturnType<typeof useGT>;

/** Refused edits stay in the editor; Cancel shows the newer text, saving again replaces it. */
function conflictMessage(
  conflicts: ReadonlyArray<InstructionsField>,
  gt: GT,
  m: ReturnType<typeof useMessages>,
): string {
  const labels = conflicts.map((field) => m(TABS.find(({ id }) => id === field)?.label) ?? field);
  return gt(
    "{fields} changed elsewhere after this page loaded it, so your edit was not saved. Cancel to load the newer text, or save again to replace it.",
    { fields: labels.join(", ") },
  );
}

const LOAD_FAILED = msg("Instructions could not be loaded.");
const NOT_CONNECTED = msg(
  "The computer with your tasks isn't connected. Reconnect it to edit instructions.",
);

/** An error on the page, translated where it is shown so a language switch keeps it. */
type PageError =
  | { readonly message: string }
  | { readonly text: string }
  | { readonly conflicts: ReadonlyArray<InstructionsField> };

function causeError(cause: unknown): PageError {
  return cause instanceof Error && cause.message.trim()
    ? { text: cause.message }
    : { message: LOAD_FAILED };
}

function pageErrorText(error: PageError, gt: GT, m: ReturnType<typeof useMessages>): string {
  if ("conflicts" in error) return conflictMessage(error.conflicts, gt, m);
  return "text" in error ? error.text : m(error.message);
}

/** Where the editor reads and saves: an environment, and the project's checkout on it. */
interface InstructionsTarget {
  readonly environmentId: EnvironmentId | null;
  readonly environmentLabel: string | null;
  readonly savedCustomInstructions: string;
  // null edits the global texts. A project's `id` is its checkout on the
  // environment, null only while no environment is connected.
  readonly project: { readonly id: string | null; readonly title: string } | null;
}

function sameTarget(left: InstructionsTarget, right: InstructionsTarget): boolean {
  return left.environmentId === right.environmentId && left.project?.id === right.project?.id;
}

/**
 * The settings scope sentence picks what this page edits: "All projects" is the
 * global texts, a project is that project's additions. Instructions live on one
 * environment's Tasks server, so the page uses the scope's representative
 * environment (the primary one when it is selected), like Keybindings.
 */
function InstructionsSettingsPage() {
  const gt = useGT();
  const { scope, search, environment } = useSettingsScope();
  const environmentId = environment?.environmentId ?? null;
  const environmentLabel = environment?.label ?? null;
  const savedCustomInstructions =
    environment?.serverConfig?.settings.customInstructions ??
    DEFAULT_SERVER_SETTINGS.customInstructions;
  const isProjectScope = scope.kind === "project" || scope.kind === "checkout";
  // Tasks keys a project's additions by its checkout on that environment.
  const memberId = isProjectScope
    ? (scope.members.find((candidate) => candidate.environmentId === environmentId)?.id ?? null)
    : null;
  const projectTitle = isProjectScope ? scope.group.displayName : null;
  const target = useMemo<InstructionsTarget>(
    () => ({
      environmentId,
      environmentLabel,
      savedCustomInstructions,
      project: projectTitle === null ? null : { id: memberId, title: projectTitle },
    }),
    [environmentId, environmentLabel, memberId, projectTitle, savedCustomInstructions],
  );
  const searchKey = JSON.stringify(search);

  // The editor keeps the target it loaded from. A new selection in the scope
  // sentence (the router asks before dropping edits) or a resolved target that
  // changes while nothing is unsaved starts a fresh editor there. While edits
  // are unsaved they stay bound to their target until the person discards them.
  const [dirty, setDirty] = useState(false);
  const [bound, setBound] = useState({ searchKey, target });
  const retargeted = bound.searchKey === searchKey && !sameTarget(bound.target, target);
  if (
    bound.searchKey !== searchKey ||
    (retargeted && !dirty) ||
    (!retargeted && bound.target !== target)
  ) {
    setBound({ searchKey, target });
    if (bound.searchKey !== searchKey) setDirty(false);
  }
  const editorTarget = retargeted ? bound.target : target;
  return (
    <SettingsPageContainer>
      {retargeted ? (
        <div
          role="status"
          className="mx-3 flex flex-wrap items-center gap-2 rounded-lg border border-border/60 px-3 py-2 text-xs text-muted-foreground sm:mx-4"
        >
          <p className="min-w-0 flex-1">
            {target.environmentLabel === null
              ? gt("No environment for this scope is connected now.")
              : gt("This scope now reads from {environment}.", {
                  environment: target.environmentLabel,
                })}{" "}
            {bound.target.environmentLabel === null
              ? gt("Your unsaved changes still save to the environment you were editing.")
              : gt("Your unsaved changes still save to {environment}.", {
                  environment: bound.target.environmentLabel,
                })}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setDirty(false);
              setBound({ searchKey, target });
            }}
          >
            {gt("Discard and switch")}
          </Button>
        </div>
      ) : null}
      {/* Shipped defaults belong to the install: a project's additions have no updates. */}
      {editorTarget.project === null && editorTarget.environmentId !== null ? (
        <InstructionUpdatesSection environmentId={editorTarget.environmentId} />
      ) : null}
      {/* A new target starts a fresh editor, so a save and its conflict check
          never mix two scopes or two checkouts. */}
      <InstructionsEditor
        key={JSON.stringify([
          bound.searchKey,
          bound.target.environmentId,
          bound.target.project?.id ?? null,
        ])}
        environmentId={editorTarget.environmentId}
        savedCustomInstructions={editorTarget.savedCustomInstructions}
        project={editorTarget.project}
        onDirtyChange={setDirty}
      />
    </SettingsPageContainer>
  );
}

const DISCARD_MESSAGE = msg("Discard your unsaved instruction changes?");

function InstructionsEditor({
  environmentId,
  savedCustomInstructions,
  project,
  onDirtyChange,
}: Omit<InstructionsTarget, "environmentLabel"> & {
  onDirtyChange: (dirty: boolean) => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const serverConfigs = useServerConfigs();
  useTasksWebAccessRevision();
  const api =
    environmentId === null ||
    (project !== null && project.id === null) ||
    !readTasksWebAccess(environmentId).canReadTasks
      ? undefined
      : readTasksWebClient(environmentId);
  const updateServerSettings = useAtomCommand(serverEnvironment.updateSettings, {
    reportFailure: false,
  });
  const projectId = project?.id ?? null;
  // The global texts a project's additions follow, shown for context.
  const [globalPrompts, setGlobalPrompts] = useState<TaskPromptSettings>();
  const [activeTab, setActiveTab] = useState<TabId>(ALL_CHATS_TAB.id);
  // The latest server texts, for Cancel; `saved` is each field's base, which
  // stays the loaded text while the field is edited.
  const [serverPrompts, setServerPrompts] = useState(
    promptDefaultsFor(project, LEGACY_TASK_WORKFLOW_VERSION),
  );
  const [{ saved, draft }, setPrompts] = useState<PromptDrafts>(() => ({
    saved: promptDefaultsFor(project, LEGACY_TASK_WORKFLOW_VERSION),
    draft: promptDefaultsFor(project, LEGACY_TASK_WORKFLOW_VERSION),
  }));
  const [workflowVersion, setWorkflowVersion] = useState<TaskWorkflowVersion>(
    LEGACY_TASK_WORKFLOW_VERSION,
  );
  // `undefined` shows the saved value, so it follows settings changes until edited.
  const [customInstructionsDraft, setCustomInstructionsDraft] = useState<AllChatsDraft>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<PageError>();
  // Cancel and Restore replace the text even while the editor has focus,
  // which a new editor does and an outside value would not.
  const [resets, setResets] = useState(0);
  const customInstructions = customInstructionsDraft?.text ?? savedCustomInstructions;
  const promptsDirty = !sameSettings(saved, draft);
  const customInstructionsDirty = customInstructions !== savedCustomInstructions;
  const dirty = promptsDirty || customInstructionsDirty;
  // The editor has no maxLength; All chats is limited where it is stored.
  const allChatsTooLong = customInstructions.length > CUSTOM_INSTRUCTIONS_MAX_CHARS;
  // A project has no All chats text.
  const tabs = project === null ? TABS : PROMPT_TABS;
  const tab = tabs.find(({ id }) => id === activeTab) ?? tabs[0];
  const editingAllChats = tab.id === ALL_CHATS_TAB.id;
  const promptDefaults = promptDefaultsFor(project, workflowVersion);

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  // Config events (provider status, keybindings, settings) reload the texts
  // without disabling the editor or replacing fields edited on the page.
  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    if (!api) {
      setLoading(false);
      setError({ message: NOT_CONNECTED });
      return () => {
        cancelled = true;
      };
    }
    void Promise.all([
      api.tasks.getPromptSettings(projectId === null ? {} : { projectId }),
      projectId === null ? undefined : api.tasks.getPromptSettings({}),
      // A server without list settings is on workflow 1.
      api.tasks.getListSettings({}).catch(() => ({})),
    ]).then(
      ([settings, global, listSettings]) => {
        if (cancelled) return;
        setServerPrompts(settings);
        setGlobalPrompts(global);
        setWorkflowVersion(taskWorkflowVersionOf(listSettings));
        setPrompts((current) => promptsAfterReload(current, settings));
        setLoading(false);
      },
      (cause) => {
        if (cancelled) return;
        setError(causeError(cause));
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, projectId, serverConfigs]);

  useEffect(() => {
    // Hand back to the saved value once settings catch up with a save.
    if (customInstructionsDraft?.text === savedCustomInstructions) {
      setCustomInstructionsDraft(undefined);
    }
  }, [customInstructionsDraft, savedCustomInstructions]);

  // Leaving the page, including a scope change in the sentence above, asks
  // before dropping unsaved edits.
  useBlocker({
    disabled: !dirty,
    enableBeforeUnload: dirty,
    shouldBlockFn: async () =>
      !(await ensureLocalApi().dialogs.confirm(m(DISCARD_MESSAGE), { variant: "destructive" })),
  });

  const editorDisabled = saving || (editingAllChats ? environmentId === null : loading || !api);
  const save = useCallback(async () => {
    if (!dirty || saving || (promptsDirty && !api) || allChatsTooLong) return;
    if (customInstructionsDirty && environmentId === null) return;
    setSaving(true);
    setError(undefined);
    try {
      // The Tasks save records every changed field, All chats included, in the
      // instructions history, and refuses fields changed elsewhere since the
      // page loaded them. Without Tasks, All chats goes to core settings.
      if (api) {
        const result = await api.tasks.updatePromptSettings(
          instructionsSaveInput({
            projectId,
            saved,
            draft,
            allChats: customInstructionsDirty ? customInstructionsDraft : undefined,
          }),
        );
        const { allChats, conflicts, ...settings } = result;
        // A refused field's base becomes the newer text, so saving again replaces it.
        setServerPrompts(settings);
        setPrompts({ saved: settings, draft: draftAfterSave(draft, result) });
        if (allChats !== undefined)
          setCustomInstructionsDraft({
            text: conflicts.includes("allChats") ? customInstructions : allChats,
            base: allChats,
          });
        if (conflicts.length > 0) {
          setError({ conflicts });
          toastManager.add({
            type: "warning",
            title: gt("Instructions changed elsewhere"),
            description: conflictMessage(conflicts, gt, m),
          });
          return;
        }
      } else if (customInstructionsDirty && environmentId !== null) {
        const result = await updateServerSettings({
          environmentId,
          input: { patch: { customInstructions } },
        });
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        const stored = result.value.customInstructions;
        setCustomInstructionsDraft({ text: stored, base: stored });
      }
      toastManager.add({ type: "success", title: gt("Instructions saved") });
    } catch (cause) {
      const failure = causeError(cause);
      setError(failure);
      toastManager.add({
        type: "error",
        title: gt("Failed to save instructions"),
        description: pageErrorText(failure, gt, m),
      });
    } finally {
      setSaving(false);
    }
  }, [
    allChatsTooLong,
    api,
    customInstructions,
    customInstructionsDirty,
    customInstructionsDraft,
    dirty,
    draft,
    environmentId,
    gt,
    m,
    projectId,
    promptsDirty,
    saved,
    saving,
    updateServerSettings,
  ]);

  useEffect(() => {
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", handleSaveShortcut);
    return () => window.removeEventListener("keydown", handleSaveShortcut);
  }, [save]);

  return (
    // The description, tabs and editor card share the scope sentence's left
    // edge and a settings section's gaps.
    <div className="flex min-w-0 flex-1 flex-col gap-2.5">
      <p className="max-w-2xl px-3 text-xs leading-normal text-muted-foreground/80 sm:px-4">
        {project === null ? (
          <T>
            <span className="text-foreground/80">
              Shared instructions for all agents across every project.
            </span>{" "}
            &ldquo;All chats&rdquo; applies to every agent in every chat and task run. The other
            tabs apply when agents create tasks, workers, or automations, and when they run a task.
            They&apos;re added after an agent&apos;s own instructions.
          </T>
        ) : (
          <T>
            Added after the global instructions, only for tasks in{" "}
            <span className="text-foreground/80">
              <Var>{project.title}</Var>
            </span>
            .
          </T>
        )}
      </p>
      <div
        role="tablist"
        aria-label={gt("Instruction type")}
        className="scrollbar-none flex min-w-0 overflow-x-auto"
      >
        {tabs.map((promptTab) => (
          <button
            key={promptTab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === promptTab.id}
            className={cn(
              "relative shrink-0 px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:px-4",
              tab.id === promptTab.id &&
                "text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-foreground sm:after:inset-x-4",
            )}
            onClick={() => setActiveTab(promptTab.id)}
          >
            {m(promptTab.label)}
          </button>
        ))}
      </div>

      {/* The actions only show while the editor (or one of its buttons) has focus,
          or while there are unsaved changes. */}
      <div className="group/editor flex min-w-0 flex-1 flex-col gap-2.5">
        {project !== null && "globalNote" in tab && globalPrompts?.[tab.id].trim() ? (
          <details className="px-3 text-xs text-muted-foreground sm:px-4">
            <summary className="cursor-pointer select-none">{m(tab.globalNote)}</summary>
            <p className="mt-2 whitespace-pre-wrap rounded-lg border border-border/60 px-3 py-2 leading-normal">
              {globalPrompts[tab.id]}
            </p>
          </details>
        ) : null}
        <SettingsGroup className="transition-colors focus-within:border-ring">
          <LazyMarkdownEditor
            key={`${tab.id}:${resets}`}
            value={editingAllChats ? customInstructions : draft[tab.id]}
            disabled={editorDisabled}
            ariaLabel={gt("{tab} instructions", { tab: m(tab.label) })}
            className={cn(
              "min-h-[50dvh] px-3 py-3 text-sm text-foreground sm:min-h-[26rem] sm:px-4",
              editorDisabled && "opacity-60",
            )}
            placeholder={
              editingAllChats
                ? gt(
                    "Instructions every agent follows in every chat, e.g. answer in Russian, never commit without asking.",
                  )
                : loading
                  ? gt("Loading…")
                  : project === null
                    ? gt("Add guidance…")
                    : gt("Add guidance for {project}…", { project: project.title })
            }
            onChange={(value) => {
              if (editingAllChats) {
                setCustomInstructionsDraft((current) => ({
                  text: value,
                  base: current?.base ?? savedCustomInstructions,
                }));
              } else {
                const promptKey = tab.id;
                setPrompts((current) => ({
                  ...current,
                  draft: { ...current.draft, [promptKey]: value },
                }));
              }
            }}
          />
        </SettingsGroup>
        {editingAllChats && allChatsTooLong ? (
          <p className="px-3 text-xs text-destructive sm:px-4">
            {gt("All chats instructions can be at most {max} characters; this text has {count}.", {
              max: CUSTOM_INSTRUCTIONS_MAX_CHARS.toLocaleString(),
              count: customInstructions.length.toLocaleString(),
            })}
          </p>
        ) : null}
        {error ? (
          <p className="px-3 text-xs text-destructive sm:px-4">{pageErrorText(error, gt, m)}</p>
        ) : null}

        <div
          className={cn(
            "sticky bottom-0 z-10 mt-auto flex flex-wrap items-center gap-2 bg-background/95 py-3 backdrop-blur transition-opacity",
            !dirty &&
              "pointer-events-none opacity-0 group-focus-within/editor:pointer-events-auto group-focus-within/editor:opacity-100",
          )}
          // Keep focus in the editor while pressing a button, so the bar does not
          // hide between mousedown and click (Safari never focuses buttons).
          onMouseDown={(event) => {
            if (event.target !== event.currentTarget) event.preventDefault();
          }}
        >
          <Button
            type="button"
            variant="outline"
            className="shrink-0"
            disabled={
              editingAllChats
                ? environmentId === null ||
                  saving ||
                  customInstructions === DEFAULT_CUSTOM_INSTRUCTIONS
                : loading || saving || draft[tab.id] === promptDefaults[tab.id]
            }
            onClick={() => {
              const promptKey = tab.id;
              setResets((count) => count + 1);
              if (promptKey === ALL_CHATS_TAB.id) {
                setCustomInstructionsDraft((current) => ({
                  text: DEFAULT_CUSTOM_INSTRUCTIONS,
                  base: current?.base ?? savedCustomInstructions,
                }));
                return;
              }
              setPrompts((current) => ({
                ...current,
                draft: { ...current.draft, [promptKey]: promptDefaults[promptKey] },
              }));
            }}
          >
            {project === null ? gt("Restore default") : gt("Clear")}
          </Button>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!dirty || saving}
              onClick={() => {
                setPrompts({ saved: serverPrompts, draft: serverPrompts });
                setCustomInstructionsDraft(undefined);
                setResets((count) => count + 1);
              }}
            >
              {gt("Cancel")}
            </Button>
            <Button
              type="button"
              disabled={!dirty || saving || (promptsDirty && !api) || allChatsTooLong}
              onClick={() => void save()}
            >
              {saving ? gt("Saving…") : gt("Save changes")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default InstructionsSettingsPage;
