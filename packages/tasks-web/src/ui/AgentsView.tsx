/* oxlint-disable t3code/no-native-title-tooltip -- ported V1 Tasks UI; moves to Tooltip with the product UI phase. */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { ArchiveRestoreIcon, ArrowLeftIcon } from "lucide-react";
import { msg, useGT, useMessages } from "gt-react";
import type {
  EnvironmentId,
  ProviderInteractionMode,
  ModelSelection,
  ProviderInstanceId,
  ProviderOptionSelection,
  RuntimeMode,
  ThreadId,
} from "@t3tools/contracts";
import {
  DEFAULT_TASK_STATUS,
  TASK_STATUSES,
  type TaskAgentRunTriggerStatus,
} from "@t3tools/tasks-contracts/v1";

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
import { SidebarSectionHeader } from "../../../../apps/web/src/sidebarProjects/SidebarSectionHeader.tsx";
import { SIDEBAR_SECTION_GAP } from "../../../../apps/web/src/sidebarMetrics/sidebarMetrics.ts";

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
  DetailColumn,
  DetailSidebarRow,
  DetailSidebarSection,
} from "./DetailSidebar.tsx";
import { WorkspaceViewLayout } from "./WorkspaceViewLayout.tsx";
import { SHOW_MANUAL_CREATE_ACTIONS } from "./manualCreation.ts";
import { preferredProject } from "./projectFilter.ts";
import { ProjectIconCell, ProjectIconHeader } from "./ProjectIconCell.tsx";
import { splitListInput, uniqueStatuses, type TasksWebProject } from "./shared.ts";
import { pickerProjectFor, pickerProjects } from "./taskProjects.ts";
import { ListEmptyState } from "./ListEmptyState.tsx";
import { GroupCount } from "./TaskStatusGroups.tsx";
import { IconAction } from "../planner/ui/IconAction.tsx";
import { LazyMarkdownEditor } from "../markdown/LazyMarkdownEditor.tsx";
import { isBotAgent } from "../bots/botData.tsx";
import { agentUpsertInput, setAgentArchived } from "./agentUpsert.ts";
import { plainErrorSentence } from "@t3tools/client-runtime/errors";

const INSTRUCTIONS_EDITOR_CLASS =
  "min-h-36 w-full flex-1 px-3 py-2 text-lg leading-8 text-foreground";
const RUNTIME_MODES: ReadonlyArray<{ value: RuntimeMode; label: string }> = [
  { value: "approval-required", label: msg("Supervised") },
  { value: "auto-accept-edits", label: msg("Auto-accept edits") },
  { value: "full-access", label: msg("Full access") },
];

export interface AgentProject extends TasksWebProject {
  readonly defaultModelSelection: ModelSelection;
}

export interface AgentsViewProps {
  readonly projects: readonly AgentProject[];
  /** Every project, for the project icon of agents whose project has no default model. */
  readonly allProjects?: readonly TasksWebProject[];
  readonly agents: readonly ScopedTaskAgent[];
  readonly tasks: readonly ScopedTask[];
  readonly runs: readonly ScopedTaskAgentRun[];
  readonly status: "loading" | "ready" | "error" | "offline";
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
  { id: "default", label: msg("Default", { $context: "interaction mode of a worker" }) },
  { id: "plan", label: msg("Plan", { $context: "interaction mode of a worker" }) },
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
    startStatuses: DEFAULT_TASK_STATUS,
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
  return plainErrorSentence(error);
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
  readonly agentProject: TasksWebProject | null;
  /** Off when the header's project select is set to one project. */
  readonly showProject: boolean;
  readonly editable: boolean;
  readonly saving: boolean;
  readonly triggerLabel: string;
  /** Harness and model display names, e.g. "Claude Code · Claude Opus 5.5". */
  readonly modelLabel: string;
  /** The row's and its switch's accessible names, translated by the caller. */
  readonly openLabel: string;
  readonly toggleLabel: string;
  readonly onOpen: () => void;
  readonly onToggleEnabled: () => void;
  /** An archived worker's row: Unarchive stands where the Pause switch is. */
  readonly unarchive?: { readonly label: string; readonly onClick: () => void };
}

export function AgentTableRow(props: AgentTableRowProps) {
  const {
    agent,
    agentProject,
    showProject,
    editable,
    saving,
    triggerLabel,
    modelLabel,
    openLabel,
    toggleLabel,
    onOpen,
    onToggleEnabled,
    unarchive,
  } = props;

  return (
    <tr
      aria-label={openLabel}
      className="cursor-pointer border-b border-border transition-colors hover:bg-muted/20"
      onClick={(event) => {
        if (!eventTargetsInteractiveRowDescendant(event)) onOpen();
      }}
    >
      {showProject ? (
        <ProjectIconCell
          project={agentProject?.favicon ?? null}
          name={agent.projectName}
          allProjects={agent.projectId === null}
        />
      ) : null}
      <td className="align-middle truncate py-4 pr-4 font-medium text-foreground">
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
      <td
        className="align-middle truncate px-4 py-4 text-muted-foreground"
        title={agent.config.interactionMode ?? "default"}
      >
        {modelLabel}
      </td>
      <td className="align-middle truncate px-4 py-4 text-muted-foreground" title={triggerLabel}>
        {triggerLabel}
      </td>
      <td
        className="align-middle px-4 py-3 text-center"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {unarchive ? (
          editable ? (
            <IconAction
              label={unarchive.label}
              track="agents.unarchive"
              variant="outline"
              disabled={saving}
              onClick={unarchive.onClick}
            >
              <ArchiveRestoreIcon />
            </IconAction>
          ) : null
        ) : (
          <Switch
            checked={agent.enabled}
            disabled={!editable || saving}
            aria-label={toggleLabel}
            onCheckedChange={(checked) => {
              if (Boolean(checked) !== agent.enabled) onToggleEnabled();
            }}
          />
        )}
      </td>
    </tr>
  );
}

export function AgentsView(props: AgentsViewProps) {
  const gt = useGT();
  const m = useMessages();
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
  // Bots have their own sidebar section and settings page. Deep links still
  // resolve against `props.agents`.
  const listedAgents = useMemo(
    () => props.agents.filter((agent) => !isBotAgent(agent) && agent.archivedAt === null),
    [props.agents],
  );
  const archivedAgents = useMemo(
    () => props.agents.filter((agent) => !isBotAgent(agent) && agent.archivedAt !== null),
    [props.agents],
  );
  const [archivedOpen, setArchivedOpen] = useState(false);
  const projectsByKey = useMemo(
    () => new Map(props.projects.map((project) => [projectKey(project), project] as const)),
    [props.projects],
  );
  const iconProjectsByKey = useMemo(
    () =>
      new Map(
        (props.allProjects ?? props.projects).map(
          (project) => [projectKey(project), project] as const,
        ),
      ),
    [props.allProjects, props.projects],
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
  const projectOptions = pickerProjects(mutableProjects);
  const selectedProject = editingAgent
    ? props.projects.find((project) => projectKey(project) === form.projectKey)
    : (mutableProjects.find((project) => projectKey(project) === form.projectKey) ??
      projectOptions[0]);
  const selectedProjectOption = selectedProject
    ? pickerProjectFor(projectOptions, selectedProject)
    : undefined;
  const selectedEnvironmentId = editingAgent?.environmentId ?? selectedProject?.environmentId;
  const baseModelSelection =
    editingAgent?.config.modelSelection ?? selectedProject?.defaultModelSelection;
  const selectedProviderCatalog = selectedEnvironmentId
    ? props.providerCatalogByEnvironment.get(selectedEnvironmentId)
    : undefined;

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
    () =>
      uniqueStatuses([...TASK_STATUSES, ...props.agents.flatMap((agent) => agent.startStatuses)]),
    [props.agents],
  );
  const tagOptions = useMemo(
    () => unique(listedAgents.flatMap((agent) => agent.startTags)),
    [listedAgents],
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
    setForm(emptyForm(preferredProject(projectOptions, null)));
    setViewMode({ kind: "create" });
  }, [projectOptions]);

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
              ? gt("Select a project")
              : !name
                ? gt("Worker name is required")
                : gt("Worker instructions are required"),
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
          title: gt("Select an available model"),
          description: gt("The selected provider or model is unavailable in this environment."),
        });
        return;
      }
      const client = props.getClient(target.environmentId);
      if (!client) {
        toastManager.add({
          type: "error",
          title: gt("Couldn't save the worker"),
          description: gt(
            "The computer with your tasks isn't connected. Reconnect, then try again.",
          ),
        });
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
          toastManager.add({ type: "success", title: gt("Worker created"), description: name });
          setViewMode(null);
        }
        props.onReload();
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: editingAgent ? gt("Failed to update worker") : gt("Failed to create worker"),
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
      gt,
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
          await client.agents.upsert({ ...agentUpsertInput(agent), enabled: !agent.enabled });
        });
        props.onReload();
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: gt("Failed to update worker"),
            description: errorDescription(error),
          }),
        );
      }
    },
    [enqueueMutation, gt, props],
  );

  const setArchived = useCallback(
    async (agent: ScopedTaskAgent, archived: boolean) => {
      const client = props.getClient(agent.environmentId);
      if (!client) return;
      try {
        let saved: Pick<ScopedTaskAgent, "enabled" | "name"> = agent;
        await enqueueMutation(agent.id, async () => {
          saved = await setAgentArchived(client, agent, archived);
        });
        toastManager.add({
          type: "success",
          title: archived ? gt("Worker archived") : gt("Worker unarchived"),
          // An unarchived worker that is switched on starts on its matching tasks at once.
          description:
            !archived && saved.enabled
              ? gt("{name} is switched on and may start on matching tasks right away.", {
                  name: saved.name,
                })
              : saved.name,
        });
        props.onReload();
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: archived ? gt("Failed to archive worker") : gt("Failed to unarchive worker"),
            description: errorDescription(error),
          }),
        );
      }
    },
    [enqueueMutation, gt, props],
  );
  const editingAgentArchived = editingAgent !== null && editingAgent.archivedAt !== null;

  const renderRow = (agent: ScopedTaskAgent) => {
    const editable = props.canMutateEnvironment(agent.environmentId);
    const agentProject = agent.projectId
      ? (iconProjectsByKey.get(`${agent.environmentId}:${agent.projectId}`) ?? null)
      : null;
    const triggerLabel = [
      agent.startStatuses.length > 0 ? agent.startStatuses.join(", ") : gt("Any status"),
      agent.startTags.length > 0 ? agent.startTags.join(", ") : gt("Any tag"),
      ...(agent.startRunStatuses.length > 0
        ? [gt("after {statuses} runs", { statuses: agent.startRunStatuses.join(", ") })]
        : []),
    ].join(" · ");
    return (
      <AgentTableRow
        key={`${agent.environmentId}:${agent.id}`}
        agent={agent}
        agentProject={agentProject}
        showProject
        editable={editable}
        saving={savingKey !== null}
        triggerLabel={triggerLabel}
        openLabel={gt("Open worker {name}", { name: agent.name })}
        toggleLabel={
          agent.enabled
            ? gt("Pause {name}", { name: agent.name })
            : gt("Resume {name}", { name: agent.name })
        }
        modelLabel={getAgentModelLabel(
          props.providerCatalogByEnvironment.get(agent.environmentId)?.entries,
          agent.config.modelSelection,
        )}
        onOpen={() => openEdit(agent)}
        onToggleEnabled={() => {
          void toggleEnabled(agent);
        }}
        {...(agent.archivedAt !== null
          ? {
              unarchive: {
                label: gt("Unarchive", { $context: "button that unarchives a worker" }),
                onClick: () => {
                  void setArchived(agent, false);
                },
              },
            }
          : {})}
      />
    );
  };

  return (
    <WorkspaceViewLayout
      title={editingAgent ? "" : isCreateMode ? gt("New worker") : gt("Workers")}
      action={
        editingAgent
          ? canEditAgent
            ? {
                ariaLabel: editingAgentArchived ? gt("Unarchive worker") : gt("Archive worker"),
                track: editingAgentArchived ? "agents.unarchive" : "agents.archive",
                disabled: savingKey !== null,
                hideIcon: true,
                label: editingAgentArchived
                  ? gt("Unarchive", { $context: "button that unarchives a worker" })
                  : gt("Archive", { $context: "button that archives a worker" }),
                onClick: () => {
                  void setArchived(editingAgent, !editingAgentArchived);
                },
              }
            : undefined
          : isCreateMode
            ? {
                ariaLabel: gt("Create worker"),
                track: "agents.create_save",
                disabled: mutableProjects.length === 0 || savingKey !== null,
                hideIcon: true,
                label: gt("Create", { $context: "button that creates a worker" }),
                onClick: () => {
                  void save();
                },
              }
            : SHOW_MANUAL_CREATE_ACTIONS.agents
              ? {
                  ariaLabel: gt("Create worker"),
                  track: "agents.create",
                  disabled: mutableProjects.length === 0 || savingKey !== null,
                  onClick: openCreate,
                }
              : undefined
      }
      leadingAction={
        editingAgent || isCreateMode
          ? {
              ariaLabel: editingAgent ? gt("Back to workers") : gt("Cancel worker creation"),
              track: editingAgent ? "agents.back" : "agents.create_cancel",
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
            {editingAgentArchived ? (
              // An archived worker never starts, so the Pause switch gives way to the label.
              <span className="shrink-0 text-sm text-muted-foreground">
                {gt("Archived", { $context: "status of an archived worker" })}
              </span>
            ) : (
              // Base UI's Switch is a span, which the header's drag region would
              // otherwise swallow in Electron.
              <span className="flex shrink-0 [-webkit-app-region:no-drag]">
                <Switch
                  checked={form.enabled}
                  disabled={!canEditAgent}
                  aria-label={
                    form.enabled
                      ? gt("Pause {name}", { name: editingAgent.name })
                      : gt("Enable {name}", { name: editingAgent.name })
                  }
                  onCheckedChange={(checked) => {
                    const enabled = Boolean(checked);
                    if (enabled !== form.enabled) commitForm({ ...form, enabled });
                  }}
                />
              </span>
            )}
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
                <LazyMarkdownEditor
                  value={form.instructions}
                  placeholder={gt("Instructions…")}
                  ariaLabel={gt("Worker instructions")}
                  className={INSTRUCTIONS_EDITOR_CLASS}
                  onChange={(instructions) => setForm((current) => ({ ...current, instructions }))}
                  onBlur={() => {
                    const instructions = form.instructions.trim();
                    if (instructions && instructions !== editingAgent.config.instructions) {
                      commitForm({ ...form, instructions });
                    }
                  }}
                />
              ) : (
                <p className="min-h-0 flex-1 whitespace-pre-wrap px-3 py-2 text-lg leading-8 text-foreground">
                  {editingAgent.config.instructions}
                </p>
              )}
            </main>
            <DetailColumn>
              <DetailSidebarSection title={gt("Details")}>
                <dl className="flex min-w-0 flex-col gap-0.5">
                  <DetailSidebarRow
                    label={gt("Name")}
                    controlSelector={canEditAgent ? "input" : undefined}
                  >
                    {canEditAgent ? (
                      <input
                        className={DETAIL_INPUT_CLASS}
                        value={form.name}
                        aria-label={gt("Worker name")}
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
                  <DetailSidebarRow label={gt("Project")}>
                    <span className="flex min-w-0 items-center justify-end gap-2">
                      {editingAgentProject ? (
                        <ProjectFavicon
                          project={editingAgentProject.favicon}
                          className="size-4 shrink-0"
                        />
                      ) : null}
                      <span className="truncate">
                        {editingAgent.projectName ?? gt("All projects")}
                      </span>
                    </span>
                  </DetailSidebarRow>
                  <DetailSidebarRow label={gt("Model")}>
                    {canEditAgent && baseModelSelection ? (
                      <ProviderModelPicker
                        environmentId={selectedEnvironmentId ?? null}
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
                    <DetailSidebarRow label={gt("Model options")} controlSelector="button">
                      <TraitsPicker
                        provider={detailModelProvider.driverKind}
                        instanceId={detailModelProvider.instanceId}
                        models={detailModelProvider.models}
                        model={detailModelSlug}
                        onPromptEdit={(edit) =>
                          commitForm({ ...form, instructions: edit(form.instructions) })
                        }
                        modelOptions={form.modelOptions}
                        allowPromptInjectedEffort={false}
                        onModelOptionsChange={(modelOptions) =>
                          commitForm({ ...form, modelOptions })
                        }
                      />
                    </DetailSidebarRow>
                  ) : !canEditAgent ? (
                    detailModelOptions.map((option) => (
                      <DetailSidebarRow key={option.label} label={option.label}>
                        <span className="truncate text-foreground">{option.value}</span>
                      </DetailSidebarRow>
                    ))
                  ) : null}
                  <DetailSidebarRow label={gt("Interaction")}>
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
                          aria-label={gt("Interaction mode")}
                        >
                          <SelectValue>
                            {m(
                              INTERACTION_MODES.find(({ id }) => id === form.interactionMode)
                                ?.label,
                            ) ?? form.interactionMode}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectPopup>
                          {INTERACTION_MODES.map((mode) => (
                            <SelectItem key={mode.id} value={mode.id}>
                              {m(mode.label)}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                    ) : (
                      (m(INTERACTION_MODES.find(({ id }) => id === form.interactionMode)?.label) ??
                      form.interactionMode)
                    )}
                  </DetailSidebarRow>
                  <DetailSidebarRow label={gt("Runtime")}>
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
                          aria-label={gt("Runtime mode")}
                        >
                          <SelectValue>
                            {m(
                              RUNTIME_MODES.find(({ value }) => value === form.runtimeMode)?.label,
                            )}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectPopup>
                          {RUNTIME_MODES.map((mode) => (
                            <SelectItem key={mode.value} value={mode.value}>
                              {m(mode.label)}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                    ) : (
                      m(RUNTIME_MODES.find(({ value }) => value === form.runtimeMode)?.label)
                    )}
                  </DetailSidebarRow>
                </dl>
              </DetailSidebarSection>
              <DetailSidebarSection title={gt("Triggers")}>
                <dl className="flex min-w-0 flex-col gap-0.5">
                  <DetailSidebarRow label={gt("Statuses")}>
                    {canEditAgent ? (
                      <input
                        className={DETAIL_INPUT_CLASS}
                        value={form.startStatuses}
                        placeholder={gt("Any status")}
                        aria-label={gt("Auto-run statuses")}
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
                      gt("Any status")
                    )}
                  </DetailSidebarRow>
                  <DetailSidebarRow label={gt("Required tags")}>
                    {canEditAgent ? (
                      <input
                        className={DETAIL_INPUT_CLASS}
                        value={form.startTags}
                        placeholder={gt("Any tag")}
                        aria-label={gt("Required tags")}
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
                      gt("Any tag")
                    )}
                  </DetailSidebarRow>
                  <DetailSidebarRow label={gt("After runs")}>
                    {canEditAgent ? (
                      <input
                        className={DETAIL_INPUT_CLASS}
                        value={form.startRunStatuses}
                        placeholder={gt("Task state")}
                        title={gt(
                          "Start when another worker's run on the task ends as failed, interrupted or blocked",
                        )}
                        aria-label={gt("Start after runs ending as")}
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
                      gt("Task state")
                    )}
                  </DetailSidebarRow>
                </dl>
              </DetailSidebarSection>
              <DetailSidebarSection title={gt("Tasks")} count={agentTasks.length}>
                <div className="flex flex-col gap-0.5">
                  {detailRunsStatus === "loading" && agentTasks.length === 0 ? (
                    <p className="px-2 py-2 text-sm text-muted-foreground">
                      {gt("Loading tasks…")}
                    </p>
                  ) : agentTasks.length === 0 ? (
                    <p className="px-2 py-2 text-sm text-muted-foreground">{gt("No tasks yet.")}</p>
                  ) : (
                    agentTasks.map(({ task, runs }) => (
                      <DetailSidebarRow
                        key={`${runs[0]?.environmentId}:${runs[0]?.taskId}`}
                        label={task?.title ?? gt("Deleted task")}
                        emphasizeLabel
                        interactive={task !== null}
                        onClick={
                          task ? () => props.onOpenTask(task.environmentId, task.id) : undefined
                        }
                      >
                        <span className="shrink-0 text-sm text-muted-foreground">
                          {gt("{count, plural, one {# run} other {# runs}}", {
                            count: runs.length,
                          })}
                        </span>
                      </DetailSidebarRow>
                    ))
                  )}
                </div>
              </DetailSidebarSection>
              <DetailSidebarSection title={gt("Threads")} count={agentThreads.length}>
                <div className="flex flex-col gap-0.5">
                  {detailRunsStatus === "loading" && agentThreads.length === 0 ? (
                    <p className="px-2 py-2 text-sm text-muted-foreground">
                      {gt("Loading threads…")}
                    </p>
                  ) : agentThreads.length === 0 ? (
                    <p className="px-2 py-2 text-sm text-muted-foreground">
                      {gt("No execution threads yet.")}
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
                          title={task?.title ?? gt("Execution thread")}
                          runStatus={run.status}
                          timestamp={run.startedAt}
                          onOpen={props.onOpenThread}
                        />
                      );
                    })
                  )}
                </div>
              </DetailSidebarSection>
            </DetailColumn>
          </div>
        </div>
      ) : isCreateMode ? (
        <div className="flex min-h-0 w-full flex-1 py-5">
          <div className="flex min-h-0 min-w-0 flex-1 gap-5">
            <main className="flex min-h-0 min-w-0 flex-1 flex-col">
              <LazyMarkdownEditor
                value={form.instructions}
                placeholder={gt("Instructions…")}
                ariaLabel={gt("Worker instructions")}
                className={INSTRUCTIONS_EDITOR_CLASS}
                onChange={(instructions) => setForm((current) => ({ ...current, instructions }))}
              />
            </main>
            <DetailColumn>
              <DetailSidebarSection title={gt("Details")}>
                <dl className="flex min-w-0 flex-col gap-0.5">
                  <DetailSidebarRow label={gt("Name")} controlSelector="input">
                    <input
                      autoFocus
                      className={DETAIL_INPUT_CLASS}
                      value={form.name}
                      placeholder={gt("Worker name…")}
                      aria-label={gt("Worker name")}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, name: event.target.value }))
                      }
                    />
                  </DetailSidebarRow>
                  <DetailSidebarRow label={gt("Project")} controlSelector="button">
                    <Select
                      value={
                        selectedProjectOption
                          ? projectKey(selectedProjectOption)
                          : selectedProject
                            ? projectKey(selectedProject)
                            : ""
                      }
                      onValueChange={(value) => {
                        const project = projectOptions.find(
                          (candidate) => projectKey(candidate) === value,
                        );
                        if (project && project !== selectedProjectOption)
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
                        aria-label={gt("Worker project")}
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
                            gt("Select project")
                          )}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectPopup>
                        {projectOptions.map((project) => (
                          <SelectItem key={projectKey(project)} value={projectKey(project)}>
                            {project.name}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  </DetailSidebarRow>
                  {baseModelSelection ? (
                    <DetailSidebarRow label={gt("Model")}>
                      <ProviderModelPicker
                        environmentId={selectedEnvironmentId ?? null}
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
                    <DetailSidebarRow label={gt("Model options")} controlSelector="button">
                      <TraitsPicker
                        provider={detailModelProvider.driverKind}
                        instanceId={detailModelProvider.instanceId}
                        models={detailModelProvider.models}
                        model={detailModelSlug}
                        onPromptEdit={(edit) =>
                          setForm((current) => ({
                            ...current,
                            instructions: edit(current.instructions),
                          }))
                        }
                        modelOptions={form.modelOptions}
                        allowPromptInjectedEffort={false}
                        onModelOptionsChange={(modelOptions) =>
                          setForm((current) => ({ ...current, modelOptions }))
                        }
                      />
                    </DetailSidebarRow>
                  ) : null}
                  <DetailSidebarRow label={gt("Interaction")} controlSelector="button">
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
                        aria-label={gt("Interaction mode")}
                      >
                        <SelectValue>
                          {m(
                            INTERACTION_MODES.find(({ id }) => id === form.interactionMode)?.label,
                          ) ?? form.interactionMode}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectPopup>
                        {INTERACTION_MODES.map((mode) => (
                          <SelectItem key={mode.id} value={mode.id}>
                            {m(mode.label)}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  </DetailSidebarRow>
                  <DetailSidebarRow label={gt("Runtime")} controlSelector="button">
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
                        aria-label={gt("Runtime mode")}
                      >
                        <SelectValue>
                          {m(RUNTIME_MODES.find(({ value }) => value === form.runtimeMode)?.label)}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectPopup>
                        {RUNTIME_MODES.map((mode) => (
                          <SelectItem key={mode.value} value={mode.value}>
                            {m(mode.label)}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  </DetailSidebarRow>
                  <DetailSidebarRow label={gt("Enabled")}>
                    <Switch
                      checked={form.enabled}
                      aria-label={gt("Enable new worker")}
                      onCheckedChange={(checked) =>
                        setForm((current) => ({ ...current, enabled: Boolean(checked) }))
                      }
                    />
                  </DetailSidebarRow>
                </dl>
              </DetailSidebarSection>
              <DetailSidebarSection title={gt("Triggers")}>
                <dl className="flex min-w-0 flex-col gap-0.5">
                  <DetailSidebarRow label={gt("Statuses")} controlSelector="input">
                    <DetailAutocompleteInput
                      ariaLabel={gt("Auto-run statuses")}
                      className={DETAIL_INPUT_CLASS}
                      onChange={(value) =>
                        setForm((current) => ({ ...current, startStatuses: value }))
                      }
                      options={statusOptions}
                      placeholder={gt("Any status")}
                      value={form.startStatuses}
                    />
                  </DetailSidebarRow>
                  <DetailSidebarRow label={gt("Required tags")} controlSelector="input">
                    <DetailAutocompleteInput
                      ariaLabel={gt("Required tags")}
                      className={DETAIL_INPUT_CLASS}
                      onChange={(value) => setForm((current) => ({ ...current, startTags: value }))}
                      options={tagOptions}
                      placeholder={gt("Any tag")}
                      value={form.startTags}
                    />
                  </DetailSidebarRow>
                </dl>
              </DetailSidebarSection>
            </DetailColumn>
          </div>
        </div>
      ) : (
        <div className="flex w-full min-w-0 flex-col gap-5 py-6">
          {hasReadOnlyProjects ? (
            <div className="rounded-md border border-border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
              {gt(
                "Some projects are read-only or do not currently have an available default provider and model. Existing workers remain readable, while invalid creation controls stay hidden.",
              )}
            </div>
          ) : null}
          {props.status === "error" ? (
            <div className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive-foreground">
              {gt("Up.computer couldn't load your workers. {reason}", {
                reason: props.errorMessage ?? gt("Try again."),
              })}
              <button type="button" className="ml-3 underline" onClick={props.onReload}>
                {gt("Retry")}
              </button>
            </div>
          ) : props.status === "offline" ? (
            <div className="rounded-md border border-border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
              {gt(
                "The environment with Tasks is not reachable right now. Workers show when it connects.",
              )}
            </div>
          ) : null}
          {props.status === "error" ? null : listedAgents.length + archivedAgents.length === 0 ? (
            // Blank while the list loads: it arrives within a moment of the page,
            // and a loading text would only flash before it.
            props.status === "loading" || props.status === "offline" ? null : (
              <ListEmptyState
                title={gt("No workers yet")}
                hint={gt(
                  "You don't need to set them up by hand. Ask any thread for something big, and it creates the workers and tasks it needs.",
                )}
              />
            )
          ) : (
            // A container, so the Archived header can keep the visible width while the table scrolls.
            <div className="@container min-w-0 overflow-x-auto">
              <table className="w-full min-w-[1000px] table-fixed border-collapse text-left text-sm">
                <thead className="border-b border-border text-muted-foreground">
                  <tr>
                    <ProjectIconHeader />
                    <th className="w-[22%] py-3 pr-4 font-medium">{gt("Name")}</th>
                    <th className="w-[25%] px-4 py-3 font-medium">{gt("Model")}</th>
                    <th className="px-4 py-3 font-medium">{gt("Triggers")}</th>
                    <th className="w-28 px-4 py-3 text-center font-medium">{gt("Status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {listedAgents.length === 0 ? (
                    <tr className="border-b border-border">
                      <td colSpan={5} className="py-4 text-muted-foreground">
                        <div className="sticky left-0 w-[100cqw]">
                          {gt("No active workers. Unarchive one to put it back to work.")}
                        </div>
                      </td>
                    </tr>
                  ) : (
                    listedAgents.map(renderRow)
                  )}
                </tbody>
                {archivedAgents.length > 0 ? (
                  <tbody data-archived-workers="">
                    <tr>
                      <td colSpan={5} className={`px-0 pb-1 ${SIDEBAR_SECTION_GAP}`}>
                        <div className="sticky left-0 w-[100cqw]">
                          <div className="-ms-2">
                            <SidebarSectionHeader
                              title={gt("Archived", { $context: "group of archived workers" })}
                              open={archivedOpen}
                              onToggle={() => setArchivedOpen((open) => !open)}
                              action={<GroupCount count={archivedAgents.length} />}
                            />
                          </div>
                        </div>
                      </td>
                    </tr>
                    {archivedOpen ? archivedAgents.map(renderRow) : null}
                  </tbody>
                ) : null}
              </table>
            </div>
          )}
        </div>
      )}
    </WorkspaceViewLayout>
  );
}
