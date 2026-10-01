import {
  DEFAULT_TASK_PROMPT_SETTINGS,
  EMPTY_TASK_PROMPT_SETTINGS,
  type InstructionsField,
  type TaskPromptSettings,
} from "@upcomputer/tasks-contracts/v1";
import { squashAtomCommandFailure } from "@upcomputer/client-runtime/state/runtime";
import {
  CUSTOM_INSTRUCTIONS_MAX_CHARS,
  DEFAULT_CUSTOM_INSTRUCTIONS,
  type UnifiedSettings,
} from "@upcomputer/contracts";
import { useCallback, useEffect, useState } from "react";

import { Button } from "../../../../apps/web/src/components/ui/button.tsx";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../../../apps/web/src/components/ui/select.tsx";
import { toastManager } from "../../../../apps/web/src/components/ui/toast.tsx";
import { SettingsPageContainer } from "../../../../apps/web/src/components/settings/settingsLayout.tsx";
import { readEnvironmentExtensionApi } from "../../../../apps/web/src/extensionApi.ts";
import { usePrimarySettings } from "../../../../apps/web/src/hooks/useSettings.ts";
import { cn } from "../../../../apps/web/src/lib/utils.ts";
import { usePrimaryEnvironmentId } from "../../../../apps/web/src/state/environments.ts";
import { useProjects, useServerConfigs } from "../../../../apps/web/src/state/entities.ts";
import { serverEnvironment } from "../../../../apps/web/src/state/server.ts";
import { useAtomCommand } from "../../../../apps/web/src/state/use-atom-command.ts";
import { TASKS_WEB_ENVIRONMENT_API } from "../environmentApi.ts";
import {
  type AllChatsDraft,
  type PromptDrafts,
  draftAfterSave,
  instructionsSaveInput,
  promptsAfterReload,
} from "./instructionsSave.ts";

// "All chats" edits the core `customInstructions` setting, which every agent
// harness adds to its prompt. The other tabs edit the Tasks prompt settings.
const ALL_CHATS_TAB = { id: "allChats", label: "All chats" } as const;

const PROMPT_TABS = [
  { id: "taskCreation", label: "Task creation" },
  { id: "agentCreation", label: "Agent creation" },
  { id: "automationCreation", label: "Automation creation" },
  { id: "taskExecution", label: "Task execution" },
] as const;

const TABS = [ALL_CHATS_TAB, ...PROMPT_TABS] as const;

type TabId = (typeof TABS)[number]["id"];

/** The scope switcher's value for the global texts; any other value is a project id. */
const ALL_PROJECTS = "all-projects";

const selectCustomInstructions = (settings: UnifiedSettings) => settings.customInstructions;

const DEFAULT_PROMPT_DRAFTS: PromptDrafts = {
  saved: DEFAULT_TASK_PROMPT_SETTINGS,
  draft: DEFAULT_TASK_PROMPT_SETTINGS,
};

function sameSettings(left: TaskPromptSettings, right: TaskPromptSettings): boolean {
  return PROMPT_TABS.every(({ id }) => left[id] === right[id]);
}

/** Refused edits stay in the editor; Cancel shows the newer text, saving again replaces it. */
function conflictMessage(conflicts: ReadonlyArray<InstructionsField>): string {
  const labels = conflicts.map((field) => TABS.find(({ id }) => id === field)?.label ?? field);
  return `${labels.join(", ")} changed elsewhere after this page loaded it, so your edit was not saved. Cancel to load the newer text, or save again to replace it.`;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error && cause.message.trim()
    ? cause.message
    : "Instructions could not be loaded.";
}

function InstructionsSettingsPage() {
  const environmentId = usePrimaryEnvironmentId();
  const serverConfigs = useServerConfigs();
  const api =
    environmentId === null
      ? undefined
      : readEnvironmentExtensionApi(environmentId, TASKS_WEB_ENVIRONMENT_API);
  const savedCustomInstructions = usePrimarySettings(selectCustomInstructions);
  const updateServerSettings = useAtomCommand(serverEnvironment.updateSettings, {
    reportFailure: false,
  });
  const allProjects = useProjects();
  const projects = allProjects.filter((project) => project.environmentId === environmentId);
  // null edits the global texts; a project id edits that project's additions.
  const [projectId, setProjectId] = useState<string | null>(null);
  const project = projects.find(({ id }) => id === projectId);
  // The global texts a project's additions follow, shown for context.
  const [globalPrompts, setGlobalPrompts] = useState<TaskPromptSettings>();
  const [activeTab, setActiveTab] = useState<TabId>(ALL_CHATS_TAB.id);
  // The latest server texts, for Cancel; `saved` is each field's base, which
  // stays the loaded text while the field is edited.
  const [serverPrompts, setServerPrompts] = useState(DEFAULT_TASK_PROMPT_SETTINGS);
  const [{ saved, draft }, setPrompts] = useState(DEFAULT_PROMPT_DRAFTS);
  // `undefined` shows the saved value, so it follows settings changes until edited.
  const [customInstructionsDraft, setCustomInstructionsDraft] = useState<AllChatsDraft>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const customInstructions = customInstructionsDraft?.text ?? savedCustomInstructions;
  const promptsDirty = !sameSettings(saved, draft);
  const customInstructionsDirty = customInstructions !== savedCustomInstructions;
  const dirty = promptsDirty || customInstructionsDirty;
  // A project has no All chats text.
  const tabs = projectId === null ? TABS : PROMPT_TABS;
  const tab = tabs.find(({ id }) => id === activeTab) ?? tabs[0];
  const editingAllChats = tab.id === ALL_CHATS_TAB.id;
  const promptDefaults =
    projectId === null ? DEFAULT_TASK_PROMPT_SETTINGS : EMPTY_TASK_PROMPT_SETTINGS;

  // Config events (provider status, keybindings, settings) reload the texts
  // without disabling the editor or replacing fields edited on the page.
  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    if (!api) {
      setLoading(false);
      setError("Connect to an environment with Tasks to edit instructions.");
      return () => {
        cancelled = true;
      };
    }
    void Promise.all([
      api.tasks.getPromptSettings(projectId === null ? {} : { projectId }),
      projectId === null ? undefined : api.tasks.getPromptSettings({}),
    ]).then(
      ([settings, global]) => {
        if (cancelled) return;
        setServerPrompts(settings);
        setGlobalPrompts(global);
        setPrompts((current) => promptsAfterReload(current, settings));
        setLoading(false);
      },
      (cause) => {
        if (cancelled) return;
        setError(errorMessage(cause));
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, environmentId, projectId, serverConfigs]);

  useEffect(() => {
    // Hand back to the saved value once settings catch up with a save.
    if (customInstructionsDraft?.text === savedCustomInstructions) {
      setCustomInstructionsDraft(undefined);
    }
  }, [customInstructionsDraft, savedCustomInstructions]);

  useEffect(() => {
    if (!dirty) return;
    const preventUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [dirty]);

  const save = useCallback(async () => {
    if (!dirty || saving || (promptsDirty && !api)) return;
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
          const message = conflictMessage(conflicts);
          setError(message);
          toastManager.add({
            type: "warning",
            title: "Instructions changed elsewhere",
            description: message,
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
      toastManager.add({ type: "success", title: "Instructions saved" });
    } catch (cause) {
      const message = errorMessage(cause);
      setError(message);
      toastManager.add({
        type: "error",
        title: "Failed to save instructions",
        description: message,
      });
    } finally {
      setSaving(false);
    }
  }, [
    api,
    customInstructions,
    customInstructionsDirty,
    customInstructionsDraft,
    dirty,
    draft,
    environmentId,
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
    <SettingsPageContainer className="max-w-5xl gap-0">
      <div className="min-w-0">
        <div className="mb-3 px-1">
          {/* Switching scope is held while there are unsaved changes, so each
              save and its conflict check stay within one scope. */}
          <Select
            value={projectId ?? ALL_PROJECTS}
            disabled={dirty || saving}
            onValueChange={(value) => {
              const next = value === null || value === ALL_PROJECTS ? null : value;
              if (next === projectId) return;
              const defaults =
                next === null ? DEFAULT_TASK_PROMPT_SETTINGS : EMPTY_TASK_PROMPT_SETTINGS;
              setProjectId(next);
              setLoading(true);
              setError(undefined);
              setServerPrompts(defaults);
              setPrompts({ saved: defaults, draft: defaults });
            }}
          >
            <SelectTrigger
              className="w-auto min-w-48"
              aria-label="Instructions scope"
              title={dirty ? "Save or cancel your changes to switch scope." : undefined}
            >
              <SelectValue>{project?.title ?? "All projects"}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value={ALL_PROJECTS}>All projects</SelectItem>
              {projects.map((candidate) => (
                <SelectItem key={candidate.id} value={candidate.id}>
                  {candidate.title}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
        <p className="mb-4 max-w-2xl px-1 text-[13px] leading-[1.45] text-muted-foreground/80">
          {projectId === null ? (
            <>
              <span className="text-foreground/80">
                Shared instructions for all agents across every project.
              </span>{" "}
              &ldquo;All chats&rdquo; applies to every agent in every chat and task run. The other
              tabs apply when agents create tasks, agents, or automations, and when they run a task.
              They&apos;re added after an agent&apos;s own instructions.
            </>
          ) : (
            <>
              Added after the global instructions, only for tasks in{" "}
              <span className="text-foreground/80">{project?.title ?? "this project"}</span>.
            </>
          )}
        </p>
        <div
          role="tablist"
          aria-label="Instruction type"
          className="scrollbar-none flex min-w-0 gap-1 overflow-x-auto px-1"
        >
          {tabs.map((promptTab) => (
            <button
              key={promptTab.id}
              type="button"
              role="tab"
              aria-selected={tab.id === promptTab.id}
              className={cn(
                "relative shrink-0 px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:px-4",
                tab.id === promptTab.id &&
                  "text-foreground after:absolute after:inset-x-2 after:bottom-[-1px] after:h-0.5 after:rounded-full after:bg-foreground",
              )}
              onClick={() => setActiveTab(promptTab.id)}
            >
              {promptTab.label}
            </button>
          ))}
        </div>
      </div>

      {/* The actions only show while the editor (or one of its buttons) has focus,
          or while there are unsaved changes. */}
      <div className="group/editor flex min-w-0 flex-1 flex-col">
        <div className="px-1 pt-6 sm:px-3 sm:pt-8">
          {projectId !== null && !editingAllChats && globalPrompts?.[tab.id].trim() ? (
            <details className="mb-3 text-[13px] text-muted-foreground">
              <summary className="cursor-pointer select-none">
                Global {tab.label.toLowerCase()} instructions, which come first
              </summary>
              <p className="mt-2 whitespace-pre-wrap rounded-lg border border-border px-3 py-2 leading-[1.5]">
                {globalPrompts[tab.id]}
              </p>
            </details>
          ) : null}
          <textarea
            value={editingAllChats ? customInstructions : draft[tab.id]}
            disabled={saving || (editingAllChats ? environmentId === null : loading || !api)}
            maxLength={editingAllChats ? CUSTOM_INSTRUCTIONS_MAX_CHARS : undefined}
            aria-label={`${tab.label} instructions`}
            className="field-sizing-content min-h-[50dvh] w-full resize-none appearance-none overflow-auto rounded-xl border border-border bg-transparent px-3 py-3 text-base leading-7 text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-[26rem] sm:px-4 sm:py-4 sm:text-lg sm:leading-8 [&::-webkit-resizer]:hidden"
            placeholder={
              editingAllChats
                ? "Instructions every agent follows in every chat, e.g. answer in Russian, never commit without asking."
                : loading
                  ? "Loading…"
                  : projectId === null
                    ? "Add guidance…"
                    : `Add guidance for ${project?.title ?? "this project"}…`
            }
            onChange={(event) => {
              const value = event.currentTarget.value;
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
          {error ? <p className="mt-3 text-xs text-destructive">{error}</p> : null}
        </div>

        <div
          className={cn(
            "sticky bottom-0 z-10 -mx-4 mt-auto flex flex-wrap items-center gap-2 bg-background/95 px-4 py-3 backdrop-blur transition-opacity sm:mx-0 sm:rounded-b-xl sm:px-3",
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
            {projectId === null ? "Restore default" : "Clear"}
          </Button>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!dirty || saving}
              onClick={() => {
                setPrompts({ saved: serverPrompts, draft: serverPrompts });
                setCustomInstructionsDraft(undefined);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!dirty || saving || (promptsDirty && !api)}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      </div>
    </SettingsPageContainer>
  );
}

export default InstructionsSettingsPage;
