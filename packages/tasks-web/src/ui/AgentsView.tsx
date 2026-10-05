/* oxlint-disable t3code/no-native-title-tooltip -- ported V1 Tasks UI; moves to Tooltip with the product UI phase. */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { ArrowLeftIcon } from "lucide-react";
import type {
  EnvironmentId,
  ProviderInteractionMode,
  ModelSelection,
  ProviderInstanceId,
  ProviderOptionSelection,
  RuntimeMode,
  ThreadId,
} from "@t3tools/contracts";
import type { TaskAgentRunTriggerStatus } from "@t3tools/tasks-contracts/v1";

import type { TasksWebRpcClient } from "../rpc/index.ts";
import type { ScopedTask, ScopedTaskAgent, ScopedTaskAgentRun } from "../state/index.ts";
import type { ProviderInstanceEntry } from "../../../../apps/web/src/providerInstances.ts";
import type { AppModelOption } from "../../../../apps/web/src/modelSelection.ts";
import { ProviderModelPicker } from "../../../../apps/web/src/components/chat/ProviderModelPicker.tsx";
import { TraitsPicker } from "../../../../apps/web/src/components/chat/TraitsPicker.tsx";
import { stackedThreadToast, toastManager } from "../../../../apps/web/src/components/ui/toast.tsx";
import { ProjectFavicon } from "../../../../apps/web/src/components/ProjectFavicon.tsx";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../../../apps/web/src/components/ui/select.tsx";
import { Switch } from "../../../../apps/web/src/components/ui/switch.tsx";
import { usePrimaryEnvironmentId } from "../../../../apps/web/src/state/environments.ts";

import { TaskThreadLink } from "./TaskThreadLink.tsx";
import {
  getAgentModelLabel,
  getAgentModelName,
  getAgentModelOptionDescriptors,
  getAgentModelOptionPresentation,
  retainValidAgentModelOptions,
} from "./agentModelOptions.ts";
import { DetailAutocompleteInput } from "./DetailAutocompleteInput.tsx";
import {
  DETAIL_INPUT_CLASS,
  DETAIL_SELECT_TRIGGER_CLASS,
  DetailSidebarRow,
  DetailSidebarSection,
} from "./DetailSidebar.tsx";
import { WorkspaceViewLayout } from "./WorkspaceViewLayout.tsx";
import { SHOW_MANUAL_CREATE_ACTIONS } from "./manualCreation.ts";
import {
  filterByProjectFilter,
  orderedProjectFilterKeys,
  preferredProject,
  type ViewProjectFilter,
} from "./projectFilter.ts";
import { splitListInput, type TasksWebProject } from "./shared.ts";

const TASK_STATUS_ACTIONS = ["new", "in progress", "ready for review", "done"] as const;
const RUNTIME_MODES: ReadonlyArray<{ value: RuntimeMode; label: string }> = [
  { value: "approval-required", label: "Supervised" },
  { value: "auto-accept-edits", label: "Auto-accept edits" },
  { value: "full-access", label: "Full access" },
];

export interface AgentProject extends TasksWebProject {
  readonly defaultModelSelection: ModelSelection;
}

export interface AgentsViewProps {
  readonly projects: readonly AgentProject[];
  readonly agents: readonly ScopedTaskAgent[];
  /**
   * The sidebar's selected project: the list shows that project's agents plus
   * global agents. Deep links still resolve agents outside the filter.
   */
  readonly projectFilter?: ViewProjectFilter | null;
  readonly tasks: readonly ScopedTask[];
  readonly runs: readonly ScopedTaskAgentRun[];
  readonly status: "loading" | "ready" | "error";
  readonly errorMessage?: string;
  readonly initialSelectedAgentKey?: string;
  readonly canMutateEnvironment: (environmentId: EnvironmentId) => boolean;
  readonly providerCatalogByEnvironment: ReadonlyMap<
    EnvironmentId,
    {
      readonly entries: readonly ProviderInstanceEntry[];
      readonly modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, readonly AppModelOption[]>;
    }
  >;
  readonly getClient: (environmentId: EnvironmentId) => TasksWebRpcClient | null;
  readonly onReload: () => void;
  readonly onNavigateBack: () => void;
  readonly onSelectedAgentKeyChange?: (agentKey: string | null) => void;
  readonly onOpenTask: (environmentId: EnvironmentId, taskId: string) => void;
  readonly onOpenThread: (environmentId: EnvironmentId, threadId: ThreadId) => void;
}

type AgentViewMode =
  | { readonly kind: "create" }
  | { readonly kind: "edit"; readonly agent: ScopedTaskAgent };

interface AgentFormState {
  readonly name: string;
  readonly projectKey: string;
  readonly enabled: boolean;
  readonly startStatuses: string;
  readonly startTags: string;
  readonly startRunStatuses: string;
  readonly instructions: string;
  readonly modelInstanceId: ProviderInstanceId | "";
  readonly modelSlug: string;
  readonly modelOptions: ReadonlyArray<ProviderOptionSelection> | undefined;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
}

/** The interaction modes v2 providers support; Ask mode was dropped. */
const INTERACTION_MODES: ReadonlyArray<{ id: ProviderInteractionMode; label: string }> = [
  { id: "default", label: "Default" },
  { id: "plan", label: "Plan" },
];

const RUN_TRIGGER_STATUSES: ReadonlyArray<TaskAgentRunTriggerStatus> = [
  "failed",
  "interrupted",
  "blocked",
];

/** Keeps only the run statuses an agent can start on. */
function runTriggerStatuses(value: string): TaskAgentRunTriggerStatus[] {
  const requested = new Set(splitListInput(value).map((status) => status.toLowerCase()));
  return RUN_TRIGGER_STATUSES.filter((status) => requested.has(status));
}

function projectKey(project: Pick<AgentProject, "environmentId" | "id">): string {
  return `${project.environmentId}:${project.id}`;
}

function agentKey(agent: Pick<ScopedTaskAgent, "environmentId" | "id">): string {
  return `${agent.environmentId}:${agent.id}`;
}

function emptyForm(project?: AgentProject): AgentFormState {
  return {
    name: "",
    projectKey: project ? projectKey(project) : "",
    enabled: true,
    startStatuses: "new",
    startTags: "",
    startRunStatuses: "",
    instructions: "",
    modelInstanceId: project?.defaultModelSelection.instanceId ?? "",
    modelSlug: project?.defaultModelSelection.model ?? "",
    modelOptions: project?.defaultModelSelection.options,
    runtimeMode: "full-access",
    interactionMode: "default",
  };
}

function agentForm(agent: ScopedTaskAgent): AgentFormState {
  return {
    name: agent.name,
    projectKey: agent.projectId ? `${agent.environmentId}:${agent.projectId}` : "",
    enabled: agent.enabled,
    startStatuses: agent.startStatuses.join(", "),
    startTags: agent.startTags.join(", "),
    startRunStatuses: agent.startRunStatuses.join(", "),
    instructions: agent.config.instructions,
    modelInstanceId: agent.config.modelSelection.instanceId,
    modelSlug: agent.config.modelSelection.model,
    modelOptions: agent.config.modelSelection.options,
    runtimeMode: agent.config.runtimeMode ?? "full-access",
    interactionMode: agent.config.interactionMode ?? "default",
  };
}

function errorDescription(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

const INTERACTIVE_ROW_DESCENDANT_SELECTOR =
  'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="switch"], [contenteditable="true"]';

function eventTargetsInteractiveRowDescendant(
  event: ReactMouseEvent<HTMLTableRowElement>,
): boolean {
  const target = event.target as { closest?: (selector: string) => Element | null } | null;
  return (
    typeof target?.closest === "function" &&
    target.closest(INTERACTIVE_ROW_DESCENDANT_SELECTOR) !== null
  );
}

interface AgentTableRowProps {
  readonly agent: ScopedTaskAgent;
  readonly agentProject: AgentProject | null;
  readonly editable: boolean;
  readonly saving: boolean;
  readonly triggerLabel: string;
  /** Harness and model display names, e.g. "Claude Code · Claude Opus 5.5". */
  readonly modelLabel: string;
  readonly onOpen: () => void;
  readonly onToggleEnabled: () => void;
}

export function AgentTableRow(props: AgentTableRowProps) {
  const {
    agent,
    agentProject,
    editable,
    saving,
    triggerLabel,
    modelLabel,
    onOpen,
    onToggleEnabled,
  } = props;

  return (
    <tr
      aria-label={`Open agent ${agent.name}`}
      className="cursor-pointer border-b border-border transition-colors hover:bg-muted/20"
      onClick={(event) => {
        if (!eventTargetsInteractiveRowDescendant(event)) onOpen();
      }}
    >
      <td className="truncate py-4 pr-4 font-medium text-foreground">
        <button
          type="button"
          className="block max-w-full truncate text-left font-medium text-foreground"
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
        >
          {agent.name}
        </button>
      </td>
      <td className="px-4 py-4 text-muted-foreground">
        <span className="flex min-w-0 items-center gap-2">
          {agentProject ? (
            <ProjectFavicon project={agentProject.favicon} className="size-4 shrink-0" />
          ) : null}
          <span className="truncate">{agent.projectName ?? "All projects"}</span>
        </span>
      </td>
      <td
        className="truncate px-4 py-4 text-muted-foreground"
        title={agent.config.interactionMode ?? "default"}
      >
        {modelLabel}
      </td>
      <td className="truncate px-4 py-4 text-muted-foreground" title={triggerLabel}>
        {triggerLabel}
      </td>
      <td
        className="px-4 py-3 text-center"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <Switch
          checked={agent.enabled}
          disabled={!editable || saving}
          aria-label={`${agent.enabled ? "Pause" : "Resume"} ${agent.name}`}
          onCheckedChange={(checked) => {
            if (Boolean(checked) !== agent.enabled) onToggleEnabled();
          }}
        />
      </td>
    </tr>
  );
}

export function AgentsView(props: AgentsViewProps) {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const [viewMode, setViewMode] = useState<AgentViewMode | null>(null);
  const [detailRuns, setDetailRuns] = useState<readonly ScopedTaskAgentRun[]>([]);
  const [detailRunsStatus, setDetailRunsStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const detailRequestRef = useRef(0);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingMutationCountRef = useRef(0);
  const createInFlightRef = useRef(false);
  const enqueueMutation = useCallback(async (key: string, mutation: () => Promise<void>) => {
    pendingMutationCountRef.current += 1;
    setSavingKey(key);
    const result = mutationQueueRef.current.then(mutation);
    mutationQueueRef.current = result.catch(() => undefined);
    try {
      await result;
    } finally {
      pendingMutationCountRef.current -= 1;
      if (pendingMutationCountRef.current === 0) setSavingKey(null);
    }
  }, []);
  const [form, setForm] = useState<AgentFormState>(() => emptyForm(props.projects[0]));
  const editTarget = viewMode?.kind === "edit" ? viewMode.agent : null;
  const editingAgent = editTarget
    ? (props.agents.find(
        (agent) => agent.environmentId === editTarget.environmentId && agent.id === editTarget.id,
      ) ?? editTarget)
    : null;
  const isCreateMode = viewMode?.kind === "create";
  const projectFilter = props.projectFilter ?? null;
  const visibleAgents = useMemo(
    () => filterByProjectFilter(props.agents, projectFilter, { includeGlobal: true }),
    [projectFilter, props.agents],
  );
  const projectsByKey = useMemo(
    () => new Map(props.projects.map((project) => [projectKey(project), project] as const)),
    [props.projects],
  );
  const mutableProjects = props.projects.filter((project) => {
    if (!props.canMutateEnvironment(project.environmentId)) return false;
    const catalog = props.providerCatalogByEnvironment.get(project.environmentId);
    const entry = catalog?.entries.find(
      (candidate) =>
        candidate.instanceId === project.defaultModelSelection.instanceId &&
        candidate.enabled &&
        candidate.installed &&
        candidate.isAvailable,
    );
    return Boolean(
      entry &&
      catalog?.modelOptionsByInstance
        .get(entry.instanceId)
        ?.some((option) => option.slug === project.defaultModelSelection.model),
    );
  });
  const selectedProject = editingAgent
    ? props.projects.find((project) => projectKey(project) === form.projectKey)
    : (mutableProjects.find((project) => projectKey(project) === form.projectKey) ??
      mutableProjects[0]);
  const selectedEnvironmentId = editingAgent?.environmentId ?? selectedProject?.environmentId;
  const baseModelSelection =
    editingAgent?.config.modelSelection ?? selectedProject?.defaultModelSelection;
  const selectedProviderCatalog = selectedEnvironmentId
    ? props.providerCatalogByEnvironment.get(selectedEnvironmentId)
    : undefined;
  const selectedProvider = selectedProviderCatalog?.entries.find(
    (entry) => entry.instanceId === (form.modelInstanceId || baseModelSelection?.instanceId),
  )?.driverKind;

  useEffect(() => {
    if (!isCreateMode || !selectedProject) return;
    const expectedProjectKey = projectKey(selectedProject);
    const catalog = props.providerCatalogByEnvironment.get(selectedProject.environmentId);
    const currentEntry = catalog?.entries.find(
      (entry) =>
        entry.instanceId === form.modelInstanceId &&
        entry.enabled &&
        entry.installed &&
        entry.isAvailable,
    );
    const currentModelIsValid = Boolean(
      currentEntry &&
      catalog?.modelOptionsByInstance
        .get(currentEntry.instanceId)
        ?.some((option) => option.slug === form.modelSlug),
    );
    if (form.projectKey === expectedProjectKey && currentModelIsValid) return;
    setForm((current) => ({
      ...current,
      projectKey: expectedProjectKey,
      modelInstanceId: selectedProject.defaultModelSelection.instanceId,
      modelSlug: selectedProject.defaultModelSelection.model,
      modelOptions: selectedProject.defaultModelSelection.options,
      interactionMode: "default",
    }));
  }, [
    isCreateMode,
    form.modelInstanceId,
    form.modelSlug,
    form.projectKey,
    props.providerCatalogByEnvironment,
    selectedProject,
  ]);
  const hasReadOnlyProjects = mutableProjects.length < props.projects.length;
  const statusOptions = useMemo(
    () => unique([...TASK_STATUS_ACTIONS, ...props.agents.flatMap((agent) => agent.startStatuses)]),
    [props.agents],
  );
  const tagOptions = useMemo(
    () => unique(props.agents.flatMap((agent) => agent.startTags)),
    [props.agents],
  );
  const agentRuns = editingAgent ? detailRuns : [];
  const agentTasks = useMemo(() => {
    const result = new Map<string, { task: ScopedTask | null; runs: ScopedTaskAgentRun[] }>();
    for (const run of agentRuns) {
      const key = `${run.environmentId}:${run.taskId}`;
      const existing = result.get(key);
      if (existing) {
        existing.runs.push(run);
        continue;
      }
      result.set(key, {
        task:
          props.tasks.find(
            (task) => task.environmentId === run.environmentId && task.id === run.taskId,
          ) ?? null,
        runs: [run],
      });
    }
    return [...result.values()];
  }, [agentRuns, props.tasks]);
  const agentThreads = useMemo(() => {
    const seen = new Set<string>();
    return agentRuns.filter((run) => {
      const key = `${run.environmentId}:${run.threadId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [agentRuns]);
  const editingAgentProject = editingAgent?.projectId
    ? (projectsByKey.get(`${editingAgent.environmentId}:${editingAgent.projectId}`) ?? null)
    : null;
  const canEditAgent = Boolean(
    editingAgent && props.canMutateEnvironment(editingAgent.environmentId),
  );
  const detailModelInstanceId = form.modelInstanceId || baseModelSelection?.instanceId;
  const detailModelSlug = form.modelSlug || baseModelSelection?.model || "";
  const detailModelProvider = selectedProviderCatalog?.entries.find(
    (entry) => entry.instanceId === detailModelInstanceId,
  );
  const detailModelLabel = detailModelInstanceId
    ? getAgentModelLabel(selectedProviderCatalog?.entries, {
        instanceId: detailModelInstanceId,
        model: detailModelSlug,
      })
    : detailModelSlug;
  const detailModelOptionDescriptors = getAgentModelOptionDescriptors({
    provider: detailModelProvider,
    model: detailModelSlug,
    options: form.modelOptions,
  });
  const detailModelOptions = getAgentModelOptionPresentation({
    provider: detailModelProvider,
    model: detailModelSlug,
    options: form.modelOptions,
  });

  const openCreate = useCallback(() => {
    detailRequestRef.current += 1;
    setDetailRuns([]);
    setDetailRunsStatus("idle");
    setForm(emptyForm(preferredProject(mutableProjects, orderedProjectFilterKeys(projectFilter))));
    setViewMode({ kind: "create" });
  }, [mutableProjects, projectFilter]);

  const showAgent = useCallback(
    (agent: ScopedTaskAgent) => {
      const fallback = props.runs.filter(
        (run) => run.environmentId === agent.environmentId && run.agentId === agent.id,
      );
      const requestId = detailRequestRef.current + 1;
      detailRequestRef.current = requestId;
      setDetailRuns(fallback);
      setDetailRunsStatus("loading");
      setForm(agentForm(agent));
      setViewMode({ kind: "edit", agent });
      const client = props.getClient(agent.environmentId);
      if (!client) {
        setDetailRunsStatus("error");
        return;
      }
      void client.agents.searchRuns({ agentId: agent.id, limit: 500 }).then(
        (result) => {
          if (detailRequestRef.current !== requestId) return;
          setDetailRuns(result.runs.map((run) => ({ ...run, environmentId: agent.environmentId })));
          setDetailRunsStatus("ready");
        },
        () => {
          if (detailRequestRef.current === requestId) setDetailRunsStatus("error");
        },
      );
    },
    [props],
  );

  const openEdit = useCallback(
    (agent: ScopedTaskAgent) => {
      if (props.onSelectedAgentKeyChange) {
        props.onSelectedAgentKeyChange(agentKey(agent));
        return;
      }
      showAgent(agent);
    },
    [props.onSelectedAgentKeyChange, showAgent],
  );

  useEffect(() => {
    const selectedKey = props.initialSelectedAgentKey;
    if (!selectedKey) {
      if (viewMode?.kind === "edit") setViewMode(null);
      return;
    }
    const agent = props.agents.find((candidate) => agentKey(candidate) === selectedKey);
    if (!agent) {
      if (props.status === "ready") {
        if (viewMode?.kind === "edit") setViewMode(null);
        props.onSelectedAgentKeyChange?.(null);
      }
      return;
    }
    if (editingAgent && agentKey(editingAgent) === selectedKey) return;
    showAgent(agent);
  }, [
    editingAgent,
    props.agents,
    props.initialSelectedAgentKey,
    props.onSelectedAgentKeyChange,
    props.status,
    showAgent,
    viewMode?.kind,
  ]);

  const save = useCallback(
    async (draft: AgentFormState = form) => {
      const creating = !editingAgent;
      if (creating && createInFlightRef.current) return;
      const name = draft.name.trim();
      const instructions = draft.instructions.trim();
      const target = editingAgent
        ? { environmentId: editingAgent.environmentId, id: editingAgent.projectId }
        : selectedProject
          ? { environmentId: selectedProject.environmentId, id: selectedProject.id }
          : null;
      if (!target || !baseModelSelection || !name || !instructions) {
        toastManager.add({
          type: "error",
          title:
            !target || !baseModelSelection
              ? "Select a project"
              : !name
                ? "Agent name is required"
                : "Agent instructions are required",
        });
        return;
      }
      const selectedEntry = selectedProviderCatalog?.entries.find(
        (entry) =>
          entry.instanceId === draft.modelInstanceId &&
          entry.enabled &&
          entry.installed &&
          entry.isAvailable,
      );
      const selectedModelIsValid = Boolean(
        selectedEntry &&
        selectedProviderCatalog?.modelOptionsByInstance
          .get(selectedEntry.instanceId)
          ?.some((option) => option.slug === draft.modelSlug),
      );
      const selectionMatchesAgent = Boolean(
        editingAgent &&
        draft.modelInstanceId === editingAgent.config.modelSelection.instanceId &&
        draft.modelSlug === editingAgent.config.modelSelection.model,
      );
      if (!selectedModelIsValid && !selectionMatchesAgent) {
        toastManager.add({
          type: "error",
          title: "Select an available model",
          description: "The selected provider or model is unavailable in this environment.",
        });
        return;
      }
      const client = props.getClient(target.environmentId);
      if (!client) {
        toastManager.add({ type: "error", title: "Task Agent API unavailable" });
        return;
      }
      if (creating) createInFlightRef.current = true;
      try {
        await enqueueMutation(editingAgent ? editingAgent.id : "create", async () => {
          await client.agents.upsert({
            ...(editingAgent ? { id: editingAgent.id } : {}),
            projectId: target.id,
            name,
            enabled: draft.enabled,
            startStatuses: splitListInput(draft.startStatuses),
            startTags: splitListInput(draft.startTags),
            startRunStatuses: runTriggerStatuses(draft.startRunStatuses),
            config: {
              ...editingAgent?.config,
              role: name,
              modelSelection: {
                instanceId: draft.modelInstanceId || baseModelSelection.instanceId,
                model: (draft.modelSlug || baseModelSelection.model) as ModelSelection["model"],
                ...(draft.modelOptions ? { options: [...draft.modelOptions] } : {}),
              },
              runtimeMode: draft.runtimeMode,
              interactionMode: draft.interactionMode,
              instructions,
            },
          });
        });
        if (!editingAgent) {
          toastManager.add({ type: "success", title: "Agent created", description: name });
          setViewMode(null);
        }
        props.onReload();
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: editingAgent ? "Failed to update agent" : "Failed to create agent",
            description: errorDescription(error),
          }),
        );
      } finally {
        if (creating) createInFlightRef.current = false;
      }
    },
    [
      baseModelSelection,
      editingAgent,
      enqueueMutation,
      form,
      props,
      selectedProject,
      selectedProviderCatalog,
    ],
  );

  const commitForm = useCallback(
    (next: AgentFormState) => {
      setForm(next);
      void save(next);
    },
    [save],
  );

  const toggleEnabled = useCallback(
    async (agent: ScopedTaskAgent) => {
      const client = props.getClient(agent.environmentId);
      if (!client) return;
      try {
        await enqueueMutation(agent.id, async () => {
          await client.agents.upsert({
            id: agent.id,
            projectId: agent.projectId,
            name: agent.name,
            enabled: !agent.enabled,
            startStatuses: [...agent.startStatuses],
            startTags: [...agent.startTags],
            startRunStatuses: [...agent.startRunStatuses],
            config: agent.config,
          });
        });
        props.onReload();
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to update agent",
            description: errorDescription(error),
          }),
        );
      }
    },
    [enqueueMutation, props],
  );

  return (
    <WorkspaceViewLayout
      title={editingAgent ? "" : isCreateMode ? "New agent" : "Agents"}
      titleDetail={editingAgent || isCreateMode ? undefined : projectFilter?.label}
      action={
        editingAgent
          ? undefined
          : isCreateMode
            ? {
                ariaLabel: "Create agent",
                disabled: mutableProjects.length === 0 || savingKey !== null,
                hideIcon: true,
                label: "Create",
                onClick: () => {
                  void save();
                },
              }
            : SHOW_MANUAL_CREATE_ACTIONS
              ? {
                  ariaLabel: "Create agent",
                  disabled: mutableProjects.length === 0 || savingKey !== null,
                  onClick: openCreate,
                }
              : undefined
      }
      leadingAction={
        editingAgent || isCreateMode
          ? {
              ariaLabel: editingAgent ? "Back to agents" : "Cancel agent creation",
              disabled: isCreateMode && savingKey !== null,
              icon: <ArrowLeftIcon className="size-4" />,
              onClick: editingAgent
                ? props.onNavigateBack
                : () => {
                    if (!createInFlightRef.current) setViewMode(null);
                  },
            }
          : undefined
      }
      toolbar={
        editingAgent ? (
          <>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
              {editingAgent.name}
            </span>
            {/* Base UI's Switch is a span, which the header's drag region would
                otherwise swallow in Electron. */}
            <span className="flex shrink-0 [-webkit-app-region:no-drag]">
              <Switch
                checked={form.enabled}
                disabled={!canEditAgent}
                aria-label={`${form.enabled ? "Pause" : "Enable"} ${editingAgent.name}`}
                onCheckedChange={(checked) => {
                  const enabled = Boolean(checked);
                  if (enabled !== form.enabled) commitForm({ ...form, enabled });
                }}
              />
            </span>
          </>
        ) : undefined
      }
      onNavigateBack={
        editingAgent
          ? props.onNavigateBack
          : isCreateMode
            ? () => {
                if (!createInFlightRef.current) setViewMode(null);
              }
            : props.onNavigateBack
      }
    >
      {editingAgent ? (
        <div className="flex min-h-0 w-full flex-1 py-5">
          <div className="flex min-h-0 min-w-0 flex-1 gap-5">
            <main className="flex min-h-0 min-w-0 flex-1 flex-col">
              {canEditAgent ? (
                <textarea
                  className="min-h-36 w-full flex-1 resize-none appearance-none overflow-auto border-0 bg-transparent px-3 py-2 text-lg leading-8 text-foreground outline-none placeholder:text-muted-foreground focus:bg-transparent focus:outline-none [&::-webkit-resizer]:hidden"
                  value={form.instructions}
                  placeholder="Instructions…"
                  aria-label="Agent instructions"
                  onChange={(event) =>
                    setForm((current) => ({ ...current, instructions: event.target.value }))
                  }
                  onBlur={() => {
                    const instructions = form.instructions.trim();
                    if (instructions && instructions !== editingAgent.config.instructions) {
                      commitForm({ ...form, instructions });
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setForm((current) => ({
                        ...current,
                        instructions: editingAgent.config.instructions,
                      }));
                      event.currentTarget.blur();
                    }
                  }}
                />
              ) : (
                <p className="min-h-0 flex-1 whitespace-pre-wrap px-3 py-2 text-lg leading-8 text-foreground">
                  {editingAgent.config.instructions}
                </p>
              )}
            </main>
            <aside
              className="min-h-0 shrink-0 overflow-y-auto bg-sidebar text-sidebar-foreground"
              style={{ width: 380 }}
            >
              <DetailSidebarSection title="Details">
                <dl className="flex min-w-0 flex-col gap-0.5">
                  <DetailSidebarRow
                    label="Name"
                    controlSelector={canEditAgent ? "input" : undefined}
                  >
                    {canEditAgent ? (
                      <input
                        className={DETAIL_INPUT_CLASS}
                        value={form.name}
                        aria-label="Agent name"
                        onChange={(event) =>
                          setForm((current) => ({ ...current, name: event.target.value }))
                        }
                        onBlur={() => {
                          const name = form.name.trim();
                          if (name && name !== editingAgent.name) commitForm({ ...form, name });
                          else if (!name)
                            setForm((current) => ({ ...current, name: editingAgent.name }));
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                          if (event.key === "Escape") {
                            setForm((current) => ({ ...current, name: editingAgent.name }));
                            event.currentTarget.blur();
                          }
                        }}
                      />
                    ) : (
                      editingAgent.name
                    )}
                  </DetailSidebarRow>
                  <DetailSidebarRow label="Project">
                    <span className="flex min-w-0 items-center justify-end gap-2">
                      {editingAgentProject ? (
                        <ProjectFavicon
                          project={editingAgentProject.favicon}
                          className="size-4 shrink-0"
                        />
                      ) : null}
                      <span className="truncate">{editingAgent.projectName ?? "All projects"}</span>
                    </span>
                  </DetailSidebarRow>
                  <DetailSidebarRow label="Model">
                    {canEditAgent && baseModelSelection ? (
                      <ProviderModelPicker
                        activeInstanceId={
                          (form.modelInstanceId ||
                            baseModelSelection.instanceId) as ProviderInstanceId
                        }
                        model={form.modelSlug || baseModelSelection.model}
                        lockedProvider={null}
                        instanceEntries={selectedProviderCatalog?.entries ?? []}
                        triggerLabel={getAgentModelName(detailModelProvider, detailModelSlug)}
                        modelOptionsByInstance={
                          selectedProviderCatalog?.modelOptionsByInstance ?? new Map()
                        }
                        onInstanceModelChange={(instanceId, model) => {
                          const provider = selectedProviderCatalog?.entries.find(
                            (entry) => entry.instanceId === instanceId,
                          );
                          commitForm({
                            ...form,
                            modelInstanceId: instanceId,
                            modelSlug: model,
                            modelOptions: retainValidAgentModelOptions({
                              provider,
                              model,
                              options: form.modelOptions,
                            }),
                          });
                        }}
                        triggerClassName="h-8 w-auto max-w-full border-0 !bg-transparent text-right text-sm font-normal shadow-none [&_[data-composer-control-chevron]]:hidden"
                      />
                    ) : (
                      <span className="truncate text-foreground">{detailModelLabel}</span>
                    )}
                  </DetailSidebarRow>
                  {canEditAgent &&
                  detailModelProvider &&
                  detailModelOptionDescriptors.length > 0 ? (
                    <DetailSidebarRow label="Model options" controlSelector="button">
                      <TraitsPicker
                        provider={detailModelProvider.driverKind}
                        instanceId={detailModelProvider.instanceId}
                        models={detailModelProvider.models}
                        model={detailModelSlug}
                        prompt={form.instructions}
                        onPromptChange={(instructions) => commitForm({ ...form, instructions })}
                        modelOptions={form.modelOptions}
                        allowPromptInjectedEffort={false}
                        onModelOptionsChange={(modelOptions) =>
                          commitForm({ ...form, modelOptions })
                        }
                        planModeEnabled={false}
                      />
                    </DetailSidebarRow>
                  ) : !canEditAgent ? (
                    detailModelOptions.map((option) => (
                      <DetailSidebarRow key={option.label} label={option.label}>
                        <span className="truncate text-foreground">{option.value}</span>
                      </DetailSidebarRow>
                    ))
                  ) : null}
                  <DetailSidebarRow label="Interaction">
                    {canEditAgent ? (
                      <Select
                        value={form.interactionMode}
                        onValueChange={(value) =>
                          commitForm({
                            ...form,
                            interactionMode: (value ?? "default") as ProviderInteractionMode,
                          })
                        }
                      >
                        <SelectTrigger
                          className={DETAIL_SELECT_TRIGGER_CLASS}
                          variant="ghost"
                          aria-label="Interaction mode"
                        >
                          <SelectValue>
                            {INTERACTION_MODES.find(({ id }) => id === form.interactionMode)
                              ?.label ?? form.interactionMode}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectPopup>
                          {INTERACTION_MODES.map((mode) => (
                            <SelectItem key={mode.id} value={mode.id}>
                              {mode.label}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                    ) : (
                      (INTERACTION_MODES.find(({ id }) => id === form.interactionMode)?.label ??
                      form.interactionMode)
                    )}
                  </DetailSidebarRow>
                  <DetailSidebarRow label="Runtime">
                    {canEditAgent ? (
                      <Select
                        value={form.runtimeMode}
                        onValueChange={(value) =>
                          commitForm({
                            ...form,
                            runtimeMode: (value ?? "full-access") as RuntimeMode,
                          })
                        }
                      >
                        <SelectTrigger
                          className={DETAIL_SELECT_TRIGGER_CLASS}
                          variant="ghost"
                          aria-label="Runtime mode"
                        >
                          <SelectValue>
                            {RUNTIME_MODES.find(({ value }) => value === form.runtimeMode)?.label}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectPopup>
                          {RUNTIME_MODES.map((mode) => (
                            <SelectItem key={mode.value} value={mode.value}>
                              {mode.label}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                    ) : (
                      RUNTIME_MODES.find(({ value }) => value === form.runtimeMode)?.label
                    )}
                  </DetailSidebarRow>
                </dl>
              </DetailSidebarSection>
              <DetailSidebarSection title="Triggers">
                <dl className="flex min-w-0 flex-col gap-0.5">
                  <DetailSidebarRow label="Statuses">
                    {canEditAgent ? (
                      <input
                        className={DETAIL_INPUT_CLASS}
                        value={form.startStatuses}
                        placeholder="Any status"
                        aria-label="Auto-run statuses"
                        onChange={(event) =>
                          setForm((current) => ({ ...current, startStatuses: event.target.value }))
                        }
                        onBlur={() => {
                          if (form.startStatuses !== editingAgent.startStatuses.join(", "))
                            commitForm(form);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                        }}
                      />
                    ) : editingAgent.startStatuses.length ? (
                      editingAgent.startStatuses.join(", ")
                    ) : (
                      "Any status"
                    )}
                  </DetailSidebarRow>
                  <DetailSidebarRow label="Required tags">
                    {canEditAgent ? (
                      <input
                        className={DETAIL_INPUT_CLASS}
                        value={form.startTags}
                        placeholder="Any tag"
                        aria-label="Required tags"
                        onChange={(event) =>
                          setForm((current) => ({ ...current, startTags: event.target.value }))
                        }
                        onBlur={() => {
                          if (form.startTags !== editingAgent.startTags.join(", "))
                            commitForm(form);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                        }}
                      />
                    ) : editingAgent.startTags.length ? (
                      editingAgent.startTags.join(", ")
                    ) : (
                      "Any tag"
                    )}
                  </DetailSidebarRow>
                  <DetailSidebarRow label="After runs">
                    {canEditAgent ? (
                      <input
                        className={DETAIL_INPUT_CLASS}
                        value={form.startRunStatuses}
                        placeholder="Task state"
                        title="Start when another agent's run on the task ends as failed, interrupted or blocked"
                        aria-label="Start after runs ending as"
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            startRunStatuses: event.target.value,
                          }))
                        }
                        onBlur={() => {
                          if (form.startRunStatuses !== editingAgent.startRunStatuses.join(", "))
                            commitForm(form);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                        }}
                      />
                    ) : editingAgent.startRunStatuses.length ? (
                      editingAgent.startRunStatuses.join(", ")
                    ) : (
                      "Task state"
                    )}
                  </DetailSidebarRow>
                </dl>
              </DetailSidebarSection>
              <DetailSidebarSection title="Tasks" count={agentTasks.length}>
                <div className="flex flex-col gap-0.5">
                  {detailRunsStatus === "loading" && agentTasks.length === 0 ? (
                    <p className="px-2 py-2 text-sm text-muted-foreground">Loading tasks…</p>
                  ) : agentTasks.length === 0 ? (
                    <p className="px-2 py-2 text-sm text-muted-foreground">No tasks yet.</p>
                  ) : (
                    agentTasks.map(({ task, runs }) => (
                      <DetailSidebarRow
                        key={`${runs[0]?.environmentId}:${runs[0]?.taskId}`}
                        label={task?.title ?? "Deleted task"}
                        emphasizeLabel
                        interactive={task !== null}
                        onClick={
                          task ? () => props.onOpenTask(task.environmentId, task.id) : undefined
                        }
                      >
                        <span className="shrink-0 text-sm text-muted-foreground">
                          {runs.length} run{runs.length === 1 ? "" : "s"}
                        </span>
                      </DetailSidebarRow>
                    ))
                  )}
                </div>
              </DetailSidebarSection>
              <DetailSidebarSection title="Threads" count={agentThreads.length}>
                <div className="flex flex-col gap-0.5">
                  {detailRunsStatus === "loading" && agentThreads.length === 0 ? (
                    <p className="px-2 py-2 text-sm text-muted-foreground">Loading threads…</p>
                  ) : agentThreads.length === 0 ? (
                    <p className="px-2 py-2 text-sm text-muted-foreground">
                      No execution threads yet.
                    </p>
                  ) : (
                    agentThreads.map((run) => {
                      const task = props.tasks.find(
                        (candidate) =>
                          candidate.environmentId === run.environmentId &&
                          candidate.id === run.taskId,
                      );
                      return (
                        <TaskThreadLink
                          key={`${run.environmentId}:${run.threadId}`}
                          environmentId={run.environmentId}
                          threadId={run.threadId}
                          title={task?.title ?? "Execution thread"}
                          runStatus={run.status}
                          timestamp={run.startedAt}
                          onOpen={props.onOpenThread}
                        />
                      );
                    })
                  )}
                </div>
              </DetailSidebarSection>
            </aside>
          </div>
        </div>
      ) : isCreateMode ? (
        <div className="flex min-h-0 w-full flex-1 py-5">
          <div className="flex min-h-0 min-w-0 flex-1 gap-5">
            <main className="flex min-h-0 min-w-0 flex-1 flex-col">
              <textarea
                className="min-h-36 w-full flex-1 resize-none appearance-none overflow-auto border-0 bg-transparent px-3 py-2 text-lg leading-8 text-foreground outline-none placeholder:text-muted-foreground focus:bg-transparent focus:outline-none [&::-webkit-resizer]:hidden"
                value={form.instructions}
                placeholder="Instructions…"
                aria-label="Agent instructions"
                onChange={(event) =>
                  setForm((current) => ({ ...current, instructions: event.target.value }))
                }
              />
            </main>
            <aside
              className="min-h-0 shrink-0 overflow-y-auto bg-sidebar text-sidebar-foreground"
              style={{ width: 380 }}
            >
              <DetailSidebarSection title="Details">
                <dl className="flex min-w-0 flex-col gap-0.5">
                  <DetailSidebarRow label="Name" controlSelector="input">
                    <input
                      autoFocus
                      className={DETAIL_INPUT_CLASS}
                      value={form.name}
                      placeholder="Agent name…"
                      aria-label="Agent name"
                      onChange={(event) =>
                        setForm((current) => ({ ...current, name: event.target.value }))
                      }
                    />
                  </DetailSidebarRow>
                  <DetailSidebarRow label="Project" controlSelector="button">
                    <Select
                      value={selectedProject ? projectKey(selectedProject) : ""}
                      onValueChange={(value) => {
                        const project = mutableProjects.find(
                          (candidate) => projectKey(candidate) === value,
                        );
                        if (project)
                          setForm((current) => ({
                            ...current,
                            projectKey: projectKey(project),
                            modelInstanceId: project.defaultModelSelection.instanceId,
                            modelSlug: project.defaultModelSelection.model,
                            modelOptions: project.defaultModelSelection.options,
                          }));
                      }}
                    >
                      <SelectTrigger
                        className={DETAIL_SELECT_TRIGGER_CLASS}
                        variant="ghost"
                        aria-label="Agent project"
                      >
                        <SelectValue>
                          {selectedProject ? (
                            <span className="flex min-w-0 items-center justify-end gap-2">
                              <ProjectFavicon
                                project={selectedProject.favicon}
                                className="size-4 shrink-0"
                              />
                              <span className="truncate">{selectedProject.name}</span>
                            </span>
                          ) : (
                            "Select project"
                          )}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectPopup>
                        {mutableProjects.map((project) => (
                          <SelectItem key={projectKey(project)} value={projectKey(project)}>
                            {project.name}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  </DetailSidebarRow>
                  {baseModelSelection ? (
                    <DetailSidebarRow label="Model">
                      <ProviderModelPicker
                        activeInstanceId={
                          (form.modelInstanceId ||
                            baseModelSelection.instanceId) as ProviderInstanceId
                        }
                        model={form.modelSlug || baseModelSelection.model}
                        lockedProvider={null}
                        instanceEntries={selectedProviderCatalog?.entries ?? []}
                        triggerLabel={getAgentModelName(detailModelProvider, detailModelSlug)}
                        modelOptionsByInstance={
                          selectedProviderCatalog?.modelOptionsByInstance ?? new Map()
                        }
                        onInstanceModelChange={(instanceId, model) =>
                          setForm((current) => {
                            const provider = selectedProviderCatalog?.entries.find(
                              (entry) => entry.instanceId === instanceId,
                            );
                            return {
                              ...current,
                              modelInstanceId: instanceId,
                              modelSlug: model,
                              modelOptions: retainValidAgentModelOptions({
                                provider,
                                model,
                                options: current.modelOptions,
                              }),
                            };
                          })
                        }
                        triggerClassName="h-8 w-auto max-w-full border-0 !bg-transparent text-right text-sm font-normal shadow-none [&_[data-composer-control-chevron]]:hidden"
                      />
                    </DetailSidebarRow>
                  ) : null}
                  {detailModelProvider && detailModelOptionDescriptors.length > 0 ? (
                    <DetailSidebarRow label="Model options" controlSelector="button">
                      <TraitsPicker
                        provider={detailModelProvider.driverKind}
                        instanceId={detailModelProvider.instanceId}
                        models={detailModelProvider.models}
                        model={detailModelSlug}
                        prompt={form.instructions}
                        onPromptChange={(instructions) =>
                          setForm((current) => ({ ...current, instructions }))
                        }
                        modelOptions={form.modelOptions}
                        allowPromptInjectedEffort={false}
                        onModelOptionsChange={(modelOptions) =>
                          setForm((current) => ({ ...current, modelOptions }))
                        }
                        planModeEnabled={false}
                      />
                    </DetailSidebarRow>
                  ) : null}
                  <DetailSidebarRow label="Interaction" controlSelector="button">
                    <Select
                      value={form.interactionMode}
                      onValueChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          interactionMode: (value ?? "default") as ProviderInteractionMode,
                        }))
                      }
                    >
                      <SelectTrigger
                        className={DETAIL_SELECT_TRIGGER_CLASS}
                        variant="ghost"
                        aria-label="Interaction mode"
                      >
                        <SelectValue>
                          {INTERACTION_MODES.find(({ id }) => id === form.interactionMode)?.label ??
                            form.interactionMode}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectPopup>
                        {INTERACTION_MODES.map((mode) => (
                          <SelectItem key={mode.id} value={mode.id}>
                            {mode.label}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  </DetailSidebarRow>
                  <DetailSidebarRow label="Runtime" controlSelector="button">
                    <Select
                      value={form.runtimeMode}
                      onValueChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          runtimeMode: (value ?? "full-access") as RuntimeMode,
                        }))
                      }
                    >
                      <SelectTrigger
                        className={DETAIL_SELECT_TRIGGER_CLASS}
                        variant="ghost"
                        aria-label="Runtime mode"
                      >
                        <SelectValue>
                          {RUNTIME_MODES.find(({ value }) => value === form.runtimeMode)?.label}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectPopup>
                        {RUNTIME_MODES.map((mode) => (
                          <SelectItem key={mode.value} value={mode.value}>
                            {mode.label}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  </DetailSidebarRow>
                  <DetailSidebarRow label="Enabled">
                    <Switch
                      checked={form.enabled}
                      aria-label="Enable new agent"
                      onCheckedChange={(checked) =>
                        setForm((current) => ({ ...current, enabled: Boolean(checked) }))
                      }
                    />
                  </DetailSidebarRow>
                </dl>
              </DetailSidebarSection>
              <DetailSidebarSection title="Triggers">
                <dl className="flex min-w-0 flex-col gap-0.5">
                  <DetailSidebarRow label="Statuses" controlSelector="input">
                    <DetailAutocompleteInput
                      ariaLabel="Auto-run statuses"
                      className={DETAIL_INPUT_CLASS}
                      onChange={(value) =>
                        setForm((current) => ({ ...current, startStatuses: value }))
                      }
                      options={statusOptions}
                      placeholder="Any status"
                      value={form.startStatuses}
                    />
                  </DetailSidebarRow>
                  <DetailSidebarRow label="Required tags" controlSelector="input">
                    <DetailAutocompleteInput
                      ariaLabel="Required tags"
                      className={DETAIL_INPUT_CLASS}
                      onChange={(value) => setForm((current) => ({ ...current, startTags: value }))}
                      options={tagOptions}
                      placeholder="Any tag"
                      value={form.startTags}
                    />
                  </DetailSidebarRow>
                </dl>
              </DetailSidebarSection>
            </aside>
          </div>
        </div>
      ) : (
        <div className="flex w-full min-w-0 flex-col gap-5 py-6">
          {hasReadOnlyProjects ? (
            <div className="rounded-md border border-border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
              Some projects are read-only or do not currently have an available default provider and
              model. Existing agents remain readable, while invalid creation controls stay hidden.
            </div>
          ) : null}
          {props.status === "error" ? (
            <div className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive-foreground">
              {props.errorMessage ?? "Failed to load agents"}
            </div>
          ) : visibleAgents.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              {props.status === "loading"
                ? "Loading agents..."
                : projectFilter && props.agents.length > 0
                  ? `No agents for ${projectFilter.label}`
                  : props.projects.length > 0
                    ? "No agents yet"
                    : "No agents yet. Set a project default model to create agents."}
            </div>
          ) : (
            <div className="min-w-0 overflow-x-auto">
              <table className="w-full min-w-[1000px] table-fixed border-collapse text-left text-sm">
                <thead className="border-b border-border text-xs text-muted-foreground">
                  <tr>
                    <th className="w-[18%] py-3 pr-4 font-medium">Name</th>
                    <th className="w-[15%] px-4 py-3 font-medium">Project</th>
                    <th className="w-[25%] px-4 py-3 font-medium">Model</th>
                    <th className="px-4 py-3 font-medium">Triggers</th>
                    <th className="w-28 px-4 py-3 text-center font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleAgents.map((agent) => {
                    const editable = props.canMutateEnvironment(agent.environmentId);
                    const agentProject = agent.projectId
                      ? (projectsByKey.get(`${agent.environmentId}:${agent.projectId}`) ?? null)
                      : null;
                    const triggerLabel = [
                      agent.startStatuses.length > 0
                        ? agent.startStatuses.join(", ")
                        : "Any status",
                      agent.startTags.length > 0 ? agent.startTags.join(", ") : "Any tag",
                      ...(agent.startRunStatuses.length > 0
                        ? [`after ${agent.startRunStatuses.join(", ")} runs`]
                        : []),
                    ].join(" · ");
                    return (
                      <AgentTableRow
                        key={`${agent.environmentId}:${agent.id}`}
                        agent={agent}
                        agentProject={agentProject}
                        editable={editable}
                        saving={savingKey !== null}
                        triggerLabel={triggerLabel}
                        modelLabel={getAgentModelLabel(
                          props.providerCatalogByEnvironment.get(agent.environmentId)?.entries,
                          agent.config.modelSelection,
                        )}
                        onOpen={() => openEdit(agent)}
                        onToggleEnabled={() => {
                          void toggleEnabled(agent);
                        }}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </WorkspaceViewLayout>
  );
}
