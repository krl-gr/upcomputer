import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  ProjectId,
  type EnvironmentId,
  type ModelSelection,
  type ThreadId,
} from "@t3tools/contracts";
import {
  BOTS_RPC_METHODS,
  TaskAgentId,
  type Bot,
  type BotMemory,
} from "@t3tools/tasks-contracts/v1";
import * as Schema from "effect/Schema";
import {
  useProjects,
  useThreadShell,
  useServerConfigs,
  waitForThreadShell,
} from "../../../../apps/web/src/state/entities.ts";
import {
  useConnectedEnvironmentIds,
  usePrimaryEnvironmentId,
} from "../../../../apps/web/src/state/environments.ts";
import { useLocalStorage } from "../../../../apps/web/src/hooks/useLocalStorage.ts";
import { usePrimarySettings } from "../../../../apps/web/src/hooks/useSettings.ts";
import {
  deriveProviderInstanceEntries,
  resolveDefaultProviderModelSelection,
  getDefaultProviderInstanceModel,
} from "../../../../apps/web/src/providerInstances.ts";
import { getAppModelOptionsForInstance } from "../../../../apps/web/src/modelSelection.ts";
import { ProviderModelPicker } from "../../../../apps/web/src/components/chat/ProviderModelPicker.tsx";
import { Button } from "../../../../apps/web/src/components/ui/button.tsx";
import { Input } from "../../../../apps/web/src/components/ui/input.tsx";
import { Textarea } from "../../../../apps/web/src/components/ui/textarea.tsx";
import {
  Dialog,
  DialogPopup,
  DialogTitle,
} from "../../../../apps/web/src/components/ui/dialog.tsx";
import {
  Collapsible,
  CollapsiblePanel,
} from "../../../../apps/web/src/components/ui/collapsible.tsx";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../../../../apps/web/src/components/ui/sidebar.tsx";
import {
  SidebarSectionHeader,
  SidebarSectionHeaderAction,
} from "../../../../apps/web/src/sidebarProjects/SidebarSectionHeader.tsx";
import {
  SIDEBAR_MENU_SCOPE,
  SIDEBAR_SECTION_GAP,
  SIDEBAR_SECTION_HEADER_GAP,
} from "../../../../apps/web/src/sidebarMetrics/sidebarMetrics.ts";
import { readTasksWebClient, useTasksWebAccess } from "../environmentApi.ts";
import { useExperimentalFeatureRpcPermission } from "../../../../apps/web/src/extensionApi.ts";
import { TraitsPicker } from "../../../../apps/web/src/components/chat/TraitsPicker.tsx";
import { BotCharacter } from "../../../../apps/web/src/components/bot-character/BotCharacter.tsx";
import { botStatus } from "./botStatus.ts";

let revision = 0;
const listeners = new Set<() => void>();
function changed() {
  revision += 1;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const palettes = ["blue", "mint", "peach", "lavender", "rose", "amber"] as const;
const paletteFor = (id: string) =>
  palettes[
    [...id].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 0) % palettes.length
  ]!;
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Bot operation failed.";

function useBots(environmentId: EnvironmentId) {
  const version = useSyncExternalStore(
    subscribe,
    () => revision,
    () => revision,
  );
  const access = useTasksWebAccess(environmentId);
  const [bots, setBots] = useState<ReadonlyArray<Bot>>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!access.canReadAgents) return;
    return readTasksWebClient(environmentId).tasks.subscribe(
      () => changed(),
      (cause) => setError(errorText(cause)),
    );
  }, [environmentId, access.canReadAgents]);
  useEffect(() => {
    if (!access.canReadAgents) return;
    let disposed = false;
    readTasksWebClient(environmentId)
      .bots.list({})
      .then(
        (value) => {
          if (!disposed) {
            setBots(value);
            setError("");
          }
        },
        (cause: unknown) => {
          if (!disposed) setError(errorText(cause));
        },
      );
    return () => {
      disposed = true;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- External revisions invalidate persisted data without changing the environment.
  }, [environmentId, version, access.canReadAgents]);
  return { bots, error, enabled: access.canReadAgents };
}

export function SidebarBots() {
  const connected = useConnectedEnvironmentIds();
  const primary = usePrimaryEnvironmentId();
  return [...new Set([...(primary ? [primary] : []), ...connected])].map((id) => (
    <EnvironmentBots key={id} environmentId={id} />
  ));
}

function EnvironmentBots({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const { bots, error, enabled } = useBots(environmentId);
  const canWrite = useExperimentalFeatureRpcPermission(environmentId, BOTS_RPC_METHODS.save);
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const [open, setOpen] = useLocalStorage(
    `upcomputer:bots-open:${environmentId}`,
    true,
    Schema.Boolean,
  );
  const [creating, setCreating] = useState(false);
  if (!enabled) return null;
  return (
    <>
      <Collapsible open={open}>
        <div className={SIDEBAR_SECTION_GAP}>
          <SidebarSectionHeader
            title="Bots"
            open={open}
            onToggle={() => setOpen(!open)}
            action={
              <SidebarSectionHeaderAction
                label="Create bot"
                onClick={() => {
                  if (canWrite) setCreating(true);
                }}
              >
                <PlusIcon className="size-3.5" />
              </SidebarSectionHeaderAction>
            }
          />
        </div>
        <CollapsiblePanel>
          <div className={`${SIDEBAR_SECTION_HEADER_GAP} ${SIDEBAR_MENU_SCOPE}`}>
            <SidebarMenu>
              {bots.map((bot) => (
                <SidebarMenuItem key={bot.agent.id}>
                  <BotRow
                    environmentId={environmentId}
                    bot={bot}
                    active={
                      params.threadId === bot.threadId && params.environmentId === environmentId
                    }
                    onClick={() => {
                      void navigate({
                        to: "/$environmentId/$threadId",
                        params: { environmentId, threadId: bot.threadId },
                      });
                    }}
                  />
                </SidebarMenuItem>
              ))}
              {bots.length === 0 ? (
                <SidebarMenuItem>
                  <SidebarMenuButton disabled={!canWrite} onClick={() => setCreating(true)}>
                    <PlusIcon />
                    <span>Create your first bot</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ) : null}
            </SidebarMenu>
            {error ? (
              <p role="alert" className="px-3 text-xs text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        </CollapsiblePanel>
      </Collapsible>
      {creating ? (
        <BotDialog environmentId={environmentId} onClose={() => setCreating(false)} />
      ) : null}
    </>
  );
}

function BotRow({
  environmentId,
  bot,
  active,
  onClick,
}: {
  readonly environmentId: EnvironmentId;
  readonly bot: Bot;
  readonly active: boolean;
  readonly onClick: () => void;
}) {
  const thread = useThreadShell(scopeThreadRef(environmentId, bot.threadId));
  const background = useThreadShell(
    bot.latestTaskRun ? scopeThreadRef(environmentId, bot.latestTaskRun.threadId) : null,
  );
  const main = botStatus(thread?.source ?? null);
  const task = botStatus(background?.source ?? null);
  const backgroundActive =
    bot.latestTaskRun?.status === "running" || bot.latestTaskRun?.status.startsWith("finalizing:");
  const status =
    main.state !== "idle"
      ? main
      : bot.latestTaskRun?.status === "blocked"
        ? { state: "attention" as const, label: "Task blocked" }
        : bot.latestTaskRun?.status === "failed"
          ? task.state === "limited"
            ? task
            : { state: "attention" as const, label: "Review task error" }
          : bot.latestTaskRun?.status === "interrupted"
            ? { state: "attention" as const, label: "Task interrupted" }
            : backgroundActive
              ? task.state === "idle"
                ? { state: "working" as const, label: "Working" }
                : task
              : main;
  return (
    <SidebarMenuButton isActive={active} onClick={onClick}>
      <span className="flex size-4 shrink-0 items-center justify-center">
        <BotCharacter
          state={status.state}
          size={24}
          palette={paletteFor(bot.agent.id)}
          decorative
        />
      </span>
      <span className="min-w-0 flex-1 truncate">{bot.agent.name}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{status.label}</span>
    </SidebarMenuButton>
  );
}

export function BotHeader({
  environmentId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const { bots, enabled } = useBots(environmentId);
  const thread = useThreadShell(scopeThreadRef(environmentId, threadId));
  const bot = bots.find((item) => item.threadId === threadId);
  const [open, setOpen] = useState(false);
  if (!enabled || !thread || thread.sidebarHidden) return null;
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {bot ? "Bot settings & memory" : "Turn into bot"}
      </Button>
      {open ? (
        <BotDialog
          environmentId={environmentId}
          {...(bot ? { bot } : { threadId })}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function BotDialog({
  environmentId,
  bot,
  threadId,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly bot?: Bot;
  readonly threadId?: ThreadId;
  readonly onClose: () => void;
}) {
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const source = useThreadShell(threadId ? scopeThreadRef(environmentId, threadId) : null);
  const navigate = useNavigate();
  const client = readTasksWebClient(environmentId).bots;
  const [id] = useState(
    () =>
      bot?.agent.id ??
      TaskAgentId.make(threadId ? `bot:${threadId}` : `bot:${crypto.randomUUID()}`),
  );
  const [name, setName] = useState(bot?.agent.name ?? source?.title ?? "New bot");
  const [role, setRole] = useState(bot?.agent.config.role ?? "Personal assistant");
  const [instructions, setInstructions] = useState(
    bot?.agent.config.instructions ??
      "Help the user, remember useful facts, and keep them informed about your work.",
  );
  const initialProject = bot?.projectId ?? source?.projectId ?? projects[0]?.id ?? "";
  const [projectId, setProjectId] = useState(initialProject);
  const [allowed, setAllowed] = useState<ReadonlyArray<ProjectId>>(
    bot?.allowedProjectIds ?? (initialProject ? [ProjectId.make(initialProject)] : []),
  );
  const [selectedOverride, setSelection] = useState<ModelSelection | undefined>(
    bot?.agent.config.modelSelection ??
      source?.modelSelection ??
      projects[0]?.defaultModelSelection ??
      undefined,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"settings" | "memory" | "work">("settings");
  const canWrite = useExperimentalFeatureRpcPermission(environmentId, BOTS_RPC_METHODS.save);
  const configs = useServerConfigs();
  const settings = usePrimarySettings();
  const providers = useMemo(
    () => deriveProviderInstanceEntries(configs.get(environmentId)?.providers ?? []),
    [configs, environmentId],
  );
  const serverProviders = configs.get(environmentId)?.providers ?? [];
  const fallbackInstance = providers.find((entry) => entry.enabled)?.instanceId;
  const fallbackModel = fallbackInstance
    ? getDefaultProviderInstanceModel(serverProviders, fallbackInstance)
    : null;
  const selection =
    selectedOverride ??
    resolveDefaultProviderModelSelection(serverProviders, null) ??
    (fallbackInstance && fallbackModel
      ? { instanceId: fallbackInstance, model: fallbackModel }
      : undefined);
  const models = useMemo(
    () =>
      new Map(
        providers.map((entry) => [
          entry.instanceId,
          getAppModelOptionsForInstance(settings, entry),
        ]),
      ),
    [providers, settings],
  );
  const act = async (run: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await run();
      changed();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogPopup>
        <div className="flex max-h-[80vh] flex-col gap-4 overflow-y-auto p-5">
          <div className="flex items-center gap-3">
            <BotCharacter state="idle" size={48} palette={paletteFor(id)} decorative />
            <DialogTitle>
              {bot ? bot.agent.name : threadId ? "Turn chat into bot" : "Create bot"}
            </DialogTitle>
          </div>
          {bot ? (
            <div className="flex gap-2">
              {(["settings", "memory", "work"] as const).map((value) => (
                <Button
                  key={value}
                  size="sm"
                  variant={tab === value ? "secondary" : "ghost"}
                  onClick={() => setTab(value)}
                >
                  {value === "settings"
                    ? "Settings"
                    : value === "memory"
                      ? "Memory"
                      : "Background work"}
                </Button>
              ))}
            </div>
          ) : null}
          {tab === "settings" ? (
            <fieldset disabled={busy || !canWrite} className="grid gap-4">
              <label className="grid gap-1 text-sm">
                Name
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="grid gap-1 text-sm">
                Role
                <Input value={role} onChange={(e) => setRole(e.target.value)} />
              </label>
              <label className="grid gap-1 text-sm">
                Instructions
                <Textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} />
              </label>
              <label className="grid gap-1 text-sm">
                Working project
                <select
                  aria-label="Working project"
                  value={projectId}
                  onChange={(e) => setProjectId(ProjectId.make(e.target.value))}
                >
                  {projects
                    .filter((project) => allowed.includes(project.id))
                    .map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.title}
                      </option>
                    ))}
                </select>
              </label>
              <fieldset className="grid gap-1 text-sm">
                <legend>Available projects</legend>
                {projects.map((project) => (
                  <label key={project.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={allowed.includes(project.id)}
                      onChange={(e) =>
                        setAllowed(
                          e.target.checked
                            ? [...allowed, project.id]
                            : allowed.filter((value) => value !== project.id),
                        )
                      }
                    />
                    {project.title}
                  </label>
                ))}
              </fieldset>
              {selection ? (
                <ProviderModelPicker
                  environmentId={environmentId}
                  activeInstanceId={selection.instanceId}
                  model={selection.model}
                  lockedProvider={null}
                  instanceEntries={providers}
                  modelOptionsByInstance={models}
                  onInstanceModelChange={(instanceId, model) => setSelection({ instanceId, model })}
                />
              ) : (
                <p>Configure a provider to choose a model.</p>
              )}
              {selection && providers.find((entry) => entry.instanceId === selection.instanceId)
                ? (() => {
                    const provider = providers.find(
                      (entry) => entry.instanceId === selection.instanceId,
                    )!;
                    return (
                      <TraitsPicker
                        provider={provider.driverKind}
                        instanceId={selection.instanceId}
                        models={provider.models}
                        model={selection.model}
                        modelOptions={selection.options}
                        prompt={instructions}
                        onPromptChange={setInstructions}
                        onModelOptionsChange={(options) =>
                          setSelection({
                            instanceId: selection.instanceId,
                            model: selection.model,
                            ...(options ? { options } : {}),
                          })
                        }
                        allowPromptInjectedEffort={false}
                        planModeEnabled={false}
                      />
                    );
                  })()
                : null}
              <p className="text-xs text-muted-foreground">
                One permanent chat. Identity and memory stay with this bot when you change its model
                or project. Project access follows the app's existing runtime permissions.
              </p>
              <Button
                disabled={
                  busy ||
                  !name.trim() ||
                  !role.trim() ||
                  !instructions.trim() ||
                  !selection ||
                  !allowed.includes(ProjectId.make(projectId))
                }
                onClick={() => {
                  if (!selection) return;
                  void act(async () => {
                    const saved = await client.save({
                      id,
                      ...(threadId ? { threadId } : {}),
                      projectId: ProjectId.make(projectId),
                      allowedProjectIds: allowed,
                      name,
                      config: {
                        ...bot?.agent.config,
                        role,
                        instructions,
                        modelSelection: selection,
                      },
                    });
                    const ready = await waitForThreadShell(
                      scopeThreadRef(environmentId, saved.threadId),
                    );
                    if (!ready) {
                      throw new Error(
                        "The bot was saved, but its chat has not reached this client. Reconnect and open it from Bots.",
                      );
                    }
                    await navigate({
                      to: "/$environmentId/$threadId",
                      params: { environmentId, threadId: saved.threadId },
                    });
                    onClose();
                  });
                }}
              >
                {busy ? "Saving…" : bot ? "Save bot" : "Create bot"}
              </Button>
              {bot ? (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    void act(async () => {
                      await client.remove({ agentId: id });
                      onClose();
                    });
                  }}
                >
                  Remove bot and memory, keep chat
                </Button>
              ) : null}
            </fieldset>
          ) : tab === "memory" && bot ? (
            <MemoryPanel bot={bot} environmentId={environmentId} />
          ) : bot ? (
            <BotWork bot={bot} environmentId={environmentId} />
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </DialogPopup>
    </Dialog>
  );
}

function MemoryPanel({
  bot,
  environmentId,
}: {
  readonly bot: Bot;
  readonly environmentId: EnvironmentId;
}) {
  const client = readTasksWebClient(environmentId).bots;
  const canWrite = useExperimentalFeatureRpcPermission(environmentId, BOTS_RPC_METHODS.remember);
  const thread = useThreadShell(scopeThreadRef(environmentId, bot.threadId));
  const [entries, setEntries] = useState<ReadonlyArray<BotMemory>>([]);
  const [text, setText] = useState("");
  const [scope, setScope] = useState<string>(bot.projectId);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let disposed = false;
    client.memory({ agentId: bot.agent.id }).then(
      (value) => {
        if (!disposed) setEntries(value);
      },
      (cause: unknown) => {
        if (!disposed) setError(errorText(cause));
      },
    );
    return () => {
      disposed = true;
    };
  }, [
    client,
    bot.agent.id,
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Run changes refresh facts saved through MCP while this editor stays open.
    thread?.latestRun?.runId,
    thread?.latestRun?.status,
    bot.latestTaskRun?.threadId,
    bot.latestTaskRun?.status,
  ]);
  const mutate = async (run: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await run();
      setEntries(await client.memory({ agentId: bot.agent.id }));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-3">
      <p className="text-xs text-muted-foreground">
        Up to 200 entries. Each turn reads up to 12,000 characters of current global and
        working-project memory. Full chat history stays saved and searchable. Existing model context
        can still contain earlier facts.
      </p>
      <Button
        variant="secondary"
        disabled={busy || !canWrite}
        onClick={() => {
          void mutate(() =>
            client.extract({ agentId: bot.agent.id, requestId: crypto.randomUUID() }),
          );
        }}
      >
        Extract memory from chat history
      </Button>
      <label className="grid gap-1 text-sm">
        New memory
        <Textarea maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <label className="grid gap-1 text-sm">
        Scope
        <select aria-label="Memory scope" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="global">Global</option>
          {bot.allowedProjectIds.map((id) => (
            <option key={id} value={id}>
              {id === bot.projectId ? "Working project" : id}
            </option>
          ))}
        </select>
      </label>
      <Button
        disabled={busy || !canWrite || !text.trim()}
        onClick={() => {
          void mutate(async () => {
            await client.remember({
              agentId: bot.agent.id,
              id: crypto.randomUUID(),
              projectId: scope === "global" ? null : ProjectId.make(scope),
              text,
              source: "user",
            });
            setText("");
          });
        }}
      >
        Remember
      </Button>
      {entries.map((entry) => (
        <MemoryEntry
          key={`${entry.id}:${entry.updatedAt}`}
          entry={entry}
          busy={busy || !canWrite}
          onSave={(value) => {
            void mutate(() => client.remember({ ...entry, text: value }));
          }}
          onDelete={() => {
            void mutate(() => client.forget({ agentId: bot.agent.id, id: entry.id }));
          }}
        />
      ))}
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No memories yet. You can also say “Remember: …” in the chat.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function MemoryEntry({
  entry,
  busy,
  onSave,
  onDelete,
}: {
  readonly entry: BotMemory;
  readonly busy: boolean;
  readonly onSave: (text: string) => void;
  readonly onDelete: () => void;
}) {
  const [text, setText] = useState(entry.text);
  return (
    <div className="grid gap-2 border-t pt-3">
      <Textarea
        aria-label="Memory text"
        maxLength={2000}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <p className="break-all text-xs text-muted-foreground">
        {entry.projectId ?? "Global"} · {entry.source} ·{" "}
        {new Date(entry.updatedAt).toLocaleString()}
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={busy || !text.trim() || text === entry.text}
          onClick={() => onSave(text)}
        >
          Save memory
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onDelete}>
          Delete memory
        </Button>
      </div>
    </div>
  );
}

function BotWork({
  bot,
  environmentId,
}: {
  readonly bot: Bot;
  readonly environmentId: EnvironmentId;
}) {
  const canWrite = useExperimentalFeatureRpcPermission(environmentId, BOTS_RPC_METHODS.assign);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        Results return to this bot's permanent chat. Open Tasks in the chat to see progress and full
        outputs.
      </p>
      <label className="grid gap-1 text-sm">
        Task title
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="grid gap-1 text-sm">
        Task details
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <Button
        disabled={busy || !canWrite || !title.trim()}
        onClick={() => {
          setBusy(true);
          void readTasksWebClient(environmentId)
            .bots.assign({ agentId: bot.agent.id, requestId, title, description })
            .then(
              () => {
                setMessage("Task assigned. Progress and results are available in this chat.");
                setTitle("");
                setDescription("");
                setRequestId(crypto.randomUUID());
              },
              (error: unknown) => setMessage(errorText(error)),
            )
            .finally(() => setBusy(false));
        }}
      >
        Assign background work
      </Button>
      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}
    </div>
  );
}
