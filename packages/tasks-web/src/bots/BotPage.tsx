import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useCanGoBack, useLocation, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  BanIcon,
  InfoIcon,
  LockIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  DEFAULT_RUNTIME_MODE,
  EnvironmentId,
  ProjectId,
  ThreadId,
  type ModelSelection,
  type RuntimeMode,
} from "@t3tools/contracts";
import {
  BOT_MEMORY_CONTEXT_BUDGET,
  BOTS_RPC_METHODS,
  botMemoryContext,
  TaskAgentId,
  type Bot,
  type BotAppearance,
  type BotMemory,
  type BotMemoryProposal,
  type BotWriteInput,
  defaultBotAppearance,
  defaultBotPortrait,
} from "@t3tools/tasks-contracts/v1";
import {
  useProjects,
  useServerConfigs,
  useThreadShell,
  waitForThreadShell,
} from "../../../../apps/web/src/state/entities.ts";
import { usePrimaryEnvironmentId } from "../../../../apps/web/src/state/environments.ts";
import { usePrimarySettings } from "../../../../apps/web/src/hooks/useSettings.ts";
import {
  deriveProviderInstanceEntries,
  getDefaultProviderInstanceModel,
  resolveDefaultProviderModelSelection,
} from "../../../../apps/web/src/providerInstances.ts";
import { getAppModelOptionsForInstance } from "../../../../apps/web/src/modelSelection.ts";
import { ProviderModelPicker } from "../../../../apps/web/src/components/chat/ProviderModelPicker.tsx";
import { TraitsPicker } from "../../../../apps/web/src/components/chat/TraitsPicker.tsx";
import {
  runtimeModeConfig,
  runtimeModeOptions,
} from "../../../../apps/web/src/components/chat/runtimeModeConfig.ts";
import { ProjectFavicon } from "../../../../apps/web/src/components/ProjectFavicon.tsx";
import { WorkspacePageContainer } from "../../../../apps/web/src/components/WorkspacePageContainer.tsx";
import {
  SettingsRow,
  SettingsSection,
} from "../../../../apps/web/src/components/settings/settingsLayout.tsx";
import { Badge } from "../../../../apps/web/src/components/ui/badge.tsx";
import { Button } from "../../../../apps/web/src/components/ui/button.tsx";
import { Input } from "../../../../apps/web/src/components/ui/input.tsx";
import { Textarea } from "../../../../apps/web/src/components/ui/textarea.tsx";
import { Switch } from "../../../../apps/web/src/components/ui/switch.tsx";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../../../apps/web/src/components/ui/select.tsx";
import {
  Tooltip,
  TooltipPopup,
  TooltipTrigger,
} from "../../../../apps/web/src/components/ui/tooltip.tsx";
import { toastManager } from "../../../../apps/web/src/components/ui/toast.tsx";
import { Toggle, ToggleGroup } from "../../../../apps/web/src/components/ui/toggle-group.tsx";
import {
  BotAccessoryIcon,
  ConfigurableBotCharacter,
  botAppearanceCatalog,
} from "../../../../apps/web/src/components/bot-character-configurable/ConfigurableBotCharacter.tsx";
import { useExperimentalFeatureRpcPermission } from "../../../../apps/web/src/extensionApi.ts";
import { formatRelativeTimeLabel } from "../../../../apps/web/src/timestampFormat.ts";
import { ensureLocalApi } from "../../../../apps/web/src/localApi.ts";
import { ThreadStatusLabel } from "../../../../apps/web/src/sidebarThreadRow/ThreadStatusLabel.tsx";
import { cn, randomUUID } from "../../../../apps/web/src/lib/utils.ts";
import { readTasksWebClient } from "../environmentApi.ts";
import { TaskThreadRunCounts } from "../ui/TaskThreadRunCounts.tsx";
import { WorkspaceViewLayout } from "../ui/WorkspaceViewLayout.tsx";
import { useAutosave } from "./botAutosave.ts";
import { botsChanged, errorText, useBots, useBotStatus, useBotTaskRunRequest } from "./botData.tsx";
import { botStatus, type BotCharacterState } from "./botStatus.ts";
import { BotPortraitPicker } from "./portraits/BotPortraitPicker.tsx";

const readSearchString = (search: Record<string, unknown>, key: string) => {
  const value = search[key];
  return typeof value === "string" && value.length > 0 ? value : null;
};

/**
 * `/bots`: one bot's page. `bot` opens a saved bot, `thread` turns that chat
 * into a bot (or opens its bot), and neither creates a new one.
 */
export default function BotRoute() {
  const search = useLocation({ select: (location) => location.search as Record<string, unknown> });
  const primary = usePrimaryEnvironmentId();
  const environment = readSearchString(search, "environment");
  const environmentId = environment ? EnvironmentId.make(environment) : primary;
  if (!environmentId) return null;
  return (
    <BotRouteContent
      environmentId={environmentId}
      botId={readSearchString(search, "bot")}
      threadId={readSearchString(search, "thread")}
    />
  );
}

function BotRouteContent({
  environmentId,
  botId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly botId: string | null;
  readonly threadId: string | null;
}) {
  const { bots, loaded, error } = useBots(environmentId);
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();
  const bot = bots.find((item) =>
    botId ? item.agent.id === botId : threadId !== null && item.threadId === threadId,
  );
  const back = () => {
    if (canGoBack) window.history.back();
    else void navigate({ to: "/" });
  };
  if (bot) {
    return <BotForm key={bot.agent.id} environmentId={environmentId} bot={bot} onBack={back} />;
  }
  if (botId) {
    return (
      <WorkspaceViewLayout title="Bot" onNavigateBack={back} navigateOnEscape={false}>
        <p className="py-6 text-sm text-muted-foreground">
          {error || (loaded ? "This bot no longer exists." : "")}
        </p>
      </WorkspaceViewLayout>
    );
  }
  // A chat may already be a bot; wait for the list before offering to convert it.
  if (threadId && !loaded) return null;
  return (
    <BotForm
      key={threadId ?? "new"}
      environmentId={environmentId}
      {...(threadId ? { threadId: ThreadId.make(threadId) } : {})}
      onBack={back}
    />
  );
}

function BotForm({
  environmentId,
  bot,
  threadId,
  onBack,
}: {
  readonly environmentId: EnvironmentId;
  readonly bot?: Bot;
  readonly threadId?: ThreadId;
  readonly onBack: () => void;
}) {
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const source = useThreadShell(threadId ? scopeThreadRef(environmentId, threadId) : null);
  const status = useBotStatus(environmentId, bot);
  const navigate = useNavigate();
  const client = readTasksWebClient(environmentId).bots;
  const [id] = useState(
    () => bot?.agent.id ?? TaskAgentId.make(threadId ? `bot:${threadId}` : `bot:${randomUUID()}`),
  );
  const [name, setName] = useState(bot?.agent.name ?? source?.title ?? "New bot");
  const [appearance, setAppearance] = useState<BotAppearance>(
    () => bot?.appearance ?? defaultBotAppearance(id),
  );
  const [instructions, setInstructions] = useState(
    bot?.agent.config.instructions ??
      "Help the user, remember useful facts, and keep them informed about your work.",
  );
  const initialProject = bot?.projectId ?? source?.projectId ?? projects[0]?.id ?? null;
  const [projectId, setProjectId] = useState<ProjectId | null>(initialProject);
  const [allowed, setAllowed] = useState<ReadonlyArray<ProjectId>>(
    bot?.allowedProjectIds ?? (initialProject ? [initialProject] : []),
  );
  const [selectedOverride, setSelection] = useState<ModelSelection | undefined>(
    bot?.agent.config.modelSelection ??
      source?.modelSelection ??
      projects[0]?.defaultModelSelection ??
      undefined,
  );
  // A chat turned into a bot keeps its permissions; a new bot gets a new thread's.
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>(
    bot?.agent.config.runtimeMode ?? source?.runtimeMode ?? DEFAULT_RUNTIME_MODE,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canWrite = useExperimentalFeatureRpcPermission(environmentId, BOTS_RPC_METHODS.save);
  const configs = useServerConfigs();
  const settings = usePrimarySettings();
  const serverProviders = configs.get(environmentId)?.providers ?? [];
  const providers = useMemo(
    () => deriveProviderInstanceEntries(configs.get(environmentId)?.providers ?? []),
    [configs, environmentId],
  );
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
  const selectedProvider = selection
    ? providers.find((entry) => entry.instanceId === selection.instanceId)
    : undefined;
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
  const editable = canWrite && !busy;
  const PermissionIcon = runtimeModeConfig[runtimeMode].icon;
  const draft: BotWriteInput | null =
    name.trim() !== "" &&
    instructions.trim() !== "" &&
    selection !== undefined &&
    projectId !== null &&
    allowed.includes(projectId)
      ? {
          id,
          ...(threadId ? { threadId } : {}),
          projectId,
          allowedProjectIds: allowed,
          name,
          appearance,
          config: {
            ...bot?.agent.config,
            // Task agents require a role; bots describe themselves through instructions.
            role: bot?.agent.config.role ?? "Personal assistant",
            instructions,
            modelSelection: selection,
            runtimeMode,
          },
        }
      : null;
  // An existing bot saves as it changes; a new one waits for Create.
  const autosave = useAutosave(bot ? draft : null, async (input) => {
    try {
      await client.save(input);
      setError("");
      botsChanged();
    } catch (cause) {
      const message = errorText(cause);
      setError(message);
      toastManager.add({
        type: "error",
        title: "Bot settings were not saved",
        description: message,
      });
      throw cause;
    }
  });
  const textKey = JSON.stringify([name, instructions]);
  const choiceKey = JSON.stringify([appearance, selection, runtimeMode, projectId, allowed]);
  // Text saves after a pause in typing or when the field loses focus; a pick saves at once.
  useEffect(() => {
    autosave.schedule(800);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- The key is the change that schedules a save.
  }, [autosave, textKey]);
  useEffect(() => {
    autosave.schedule(0);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- The key is the change that schedules a save.
  }, [autosave, choiceKey]);
  const saveNow = () => autosave.schedule(0);

  const act = async (run: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await run();
      botsChanged();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };
  const create = () => {
    if (!draft) return;
    void act(async () => {
      const saved = await client.save(draft);
      const ready = await waitForThreadShell(scopeThreadRef(environmentId, saved.threadId));
      if (!ready) {
        throw new Error(
          "The bot was saved, but its chat has not reached this client. Reconnect and open it from Bots.",
        );
      }
      await navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId, threadId: saved.threadId },
      });
    });
  };
  const toggleProject = (project: ProjectId, on: boolean) => {
    const next = on ? [...allowed, project] : allowed.filter((value) => value !== project);
    setAllowed(next);
    if (on && (projectId === null || !allowed.includes(projectId))) setProjectId(project);
    if (!on && project === projectId) setProjectId(next[0] ?? null);
  };

  return (
    <WorkspaceViewLayout
      title={bot ? bot.agent.name : threadId ? "Turn into bot" : "New bot"}
      onNavigateBack={onBack}
      navigateOnEscape={false}
      inset={false}
      leadingAction={{
        ariaLabel: "Back",
        icon: <ArrowLeftIcon className="size-4" />,
        onClick: onBack,
      }}
      action={
        bot
          ? undefined
          : {
              ariaLabel: "Create bot",
              label: busy ? "Creating…" : "Create bot",
              hideIcon: true,
              disabled: !editable || draft === null,
              onClick: create,
            }
      }
    >
      <WorkspacePageContainer>
        {error ? (
          <p role="alert" className="px-3 text-sm text-destructive sm:px-4">
            {error}
          </p>
        ) : null}
        <SettingsSection title="Appearance">
          <div className="flex items-center gap-3 px-3 py-3 sm:px-4">
            {appearance.style === "character" ? (
              <CharacterPreview appearance={appearance} state={status.state} />
            ) : (
              <BotPortraitPicker
                value={appearance.portrait ?? defaultBotPortrait(id)}
                working={status.state === "working"}
                disabled={!editable}
                onChange={(portrait) => setAppearance({ ...appearance, portrait })}
              />
            )}
            <label className="grid min-w-0 flex-1 gap-1.5 text-sm font-medium">
              Name
              <Input
                value={name}
                disabled={!editable}
                aria-invalid={name.trim() === ""}
                onChange={(event) => setName(event.target.value)}
                onBlur={saveNow}
              />
            </label>
          </div>
          <SettingsRow
            title="Style"
            control={
              <ToggleGroup
                aria-label="Style"
                variant="segmented"
                disabled={!editable}
                value={[appearance.style ?? "portrait"]}
                onValueChange={(next) => {
                  const style = next[0];
                  if (style === "portrait" || style === "character")
                    setAppearance({ ...appearance, style });
                }}
              >
                <Toggle value="portrait">Portrait</Toggle>
                <Toggle value="character">Character</Toggle>
              </ToggleGroup>
            }
          />
          {appearance.style === "character" ? (
            <AppearancePicker
              appearance={appearance}
              disabled={!editable}
              onAppearanceChange={setAppearance}
            />
          ) : null}
        </SettingsSection>

        <SettingsSection title="Instructions" hideTitle>
          <SettingsRow title="Instructions">
            <div className="pt-2 pb-2">
              <Textarea
                aria-label="Instructions"
                value={instructions}
                disabled={!editable}
                aria-invalid={instructions.trim() === ""}
                onChange={(event) => setInstructions(event.target.value)}
                onBlur={saveNow}
              />
            </div>
          </SettingsRow>
        </SettingsSection>

        <SettingsSection title="Model" hideTitle>
          <SettingsRow
            title="Model"
            control={
              selection ? (
                <div className="flex items-center gap-1">
                  <ProviderModelPicker
                    environmentId={environmentId}
                    activeInstanceId={selection.instanceId}
                    model={selection.model}
                    lockedProvider={null}
                    instanceEntries={providers}
                    modelOptionsByInstance={models}
                    disabled={!editable}
                    onInstanceModelChange={(instanceId, model) =>
                      setSelection({ instanceId, model })
                    }
                  />
                  {selectedProvider ? (
                    <TraitsPicker
                      provider={selectedProvider.driverKind}
                      instanceId={selection.instanceId}
                      models={selectedProvider.models}
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
                  ) : null}
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">Configure a provider first</span>
              )
            }
          />
          <SettingsRow
            title="Permissions"
            description="For the bot's chat and its background tasks."
            control={
              <Select
                value={runtimeMode}
                disabled={!editable}
                onValueChange={(value) => {
                  if (value) setRuntimeMode(value);
                }}
              >
                <SelectTrigger size="sm" aria-label="Permissions">
                  <PermissionIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <SelectValue>{runtimeModeConfig[runtimeMode].label}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {runtimeModeOptions.map((mode) => {
                    const option = runtimeModeConfig[mode];
                    const Icon = option.icon;
                    return (
                      <SelectItem key={mode} value={mode} className="min-w-64">
                        <div className="grid gap-0.5">
                          <span className="inline-flex items-center gap-1.5 font-medium">
                            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                            {option.label}
                          </span>
                          <span className="text-xs leading-4 text-muted-foreground">
                            {option.description}
                          </span>
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectPopup>
              </Select>
            }
          />
        </SettingsSection>

        <SettingsSection
          title="Projects"
          titleAction={
            <InfoTip label="About projects">
              The bot works in the working project and can use memory and tasks of the available
              ones.
            </InfoTip>
          }
        >
          <SettingsRow
            title="Working project"
            control={
              <Select
                value={projectId ?? ""}
                disabled={!editable || allowed.length === 0}
                onValueChange={(value) => {
                  const next = allowed.find((candidate) => candidate === value);
                  if (next) setProjectId(next);
                }}
              >
                <SelectTrigger aria-label="Working project" className="min-w-48">
                  <SelectValue>
                    {(() => {
                      const project = projects.find((item) => item.id === projectId);
                      return project ? <ProjectLabel project={project} /> : "Choose a project";
                    })()}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {projects
                    .filter((project) => allowed.includes(project.id))
                    .map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        <ProjectLabel project={project} />
                      </SelectItem>
                    ))}
                </SelectPopup>
              </Select>
            }
          />
          {projects.map((project) => (
            <SettingsRow
              key={project.id}
              title={<ProjectLabel project={project} />}
              control={
                <Switch
                  aria-label={`Available: ${project.title}`}
                  checked={allowed.includes(project.id)}
                  disabled={!editable}
                  onCheckedChange={(checked) => toggleProject(project.id, checked)}
                />
              }
            />
          ))}
        </SettingsSection>

        {bot ? (
          <>
            <MemorySections bot={bot} environmentId={environmentId} projects={projects} />
            <BackgroundWork bot={bot} environmentId={environmentId} />
            <SettingsSection title="Remove">
              <SettingsRow
                title="Remove bot"
                description="Deletes its memory. Its chat returns to Threads."
                control={
                  <Button
                    variant="destructive-outline"
                    size="sm"
                    disabled={!editable}
                    onClick={() => {
                      // A save that lands after removal would recreate the bot.
                      const saving = autosave.stop();
                      void act(async () => {
                        await saving;
                        await client.remove({ agentId: id }).catch((cause: unknown) => {
                          autosave.resume();
                          throw cause;
                        });
                        await navigate({
                          to: "/$environmentId/$threadId",
                          params: { environmentId, threadId: bot.threadId },
                        });
                      });
                    }}
                  >
                    Remove
                  </Button>
                }
              />
            </SettingsSection>
          </>
        ) : null}
      </WorkspacePageContainer>
    </WorkspaceViewLayout>
  );
}

function InfoTip({ label, children }: { readonly label: string; readonly children: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        delay={200}
        render={
          <Button size="icon-micro" variant="ghost-muted" aria-label={label}>
            <InfoIcon className="size-3.5" />
          </Button>
        }
      />
      <TooltipPopup side="top">{children}</TooltipPopup>
    </Tooltip>
  );
}

function ProjectLabel({ project }: { readonly project: EnvironmentProject }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <ProjectFavicon project={project} className="size-4 shrink-0" />
      <span className="truncate">{project.title}</span>
    </span>
  );
}

/** The shape character, framed like the portrait button so switching styles does not move the row. */
function CharacterPreview({
  appearance,
  state,
}: {
  readonly appearance: BotAppearance;
  readonly state: BotCharacterState;
}) {
  const shape = botAppearanceCatalog.shapes.find((entry) => entry.id === appearance.shape);
  const color = botAppearanceCatalog.colors.find((entry) => entry.id === appearance.color);
  return (
    <div className="flex w-24 shrink-0 flex-col items-center gap-0.5">
      <span className="flex size-20 items-center justify-center">
        <ConfigurableBotCharacter appearance={appearance} state={state} size={80} decorative />
      </span>
      <span className="w-full truncate text-center text-xs text-muted-foreground">
        {color && shape ? `${color.label} ${shape.label.toLowerCase()}` : "Character"}
      </span>
    </div>
  );
}

/** A picture option, styled like the project icon picker's tiles. */
function Tile({
  label,
  selected,
  disabled,
  round = false,
  onSelect,
  children,
}: {
  readonly label: string;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly round?: boolean;
  readonly onSelect: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            aria-pressed={selected}
            disabled={disabled}
            className={cn(
              "flex items-center justify-center border border-transparent outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
              round ? "size-8 rounded-full" : "size-12 rounded-md hover:bg-accent",
              selected && (round ? "border-foreground/64" : "border-border bg-accent"),
            )}
            onClick={onSelect}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}

function AppearancePicker({
  appearance,
  disabled,
  onAppearanceChange,
}: {
  readonly appearance: BotAppearance;
  readonly disabled: boolean;
  readonly onAppearanceChange: (appearance: BotAppearance) => void;
}) {
  return (
    <>
      <SettingsRow title="Shape">
        <div role="group" aria-label="Shape" className="flex flex-wrap gap-1 pt-2 pb-2">
          {botAppearanceCatalog.shapes.map((shape) => (
            <Tile
              key={shape.id}
              label={shape.label}
              selected={appearance.shape === shape.id}
              disabled={disabled}
              onSelect={() => onAppearanceChange({ ...appearance, shape: shape.id })}
            >
              <ConfigurableBotCharacter
                appearance={{ ...appearance, shape: shape.id, accessory: "none" }}
                state="idle"
                size={32}
                decorative
              />
            </Tile>
          ))}
        </div>
      </SettingsRow>
      <SettingsRow title="Color">
        <div role="group" aria-label="Color" className="flex flex-wrap gap-1.5 pt-2 pb-2">
          {botAppearanceCatalog.colors.map((color) => (
            <Tile
              key={color.id}
              label={color.label}
              round
              selected={appearance.color === color.id}
              disabled={disabled}
              onSelect={() => onAppearanceChange({ ...appearance, color: color.id })}
            >
              <span
                className="size-6 rounded-full"
                // Illustration colors from the character catalog, not theme tokens.
                style={{ background: `linear-gradient(135deg, ${color.fill}, ${color.shade})` }}
              />
            </Tile>
          ))}
        </div>
      </SettingsRow>
      <SettingsRow title="Accessories">
        <div role="group" aria-label="Accessories" className="flex flex-wrap gap-1 pt-2 pb-2">
          {botAppearanceCatalog.accessories.map((accessory) => (
            <Tile
              key={accessory.id}
              label={accessory.label}
              selected={appearance.accessory === accessory.id}
              disabled={disabled}
              onSelect={() => onAppearanceChange({ ...appearance, accessory: accessory.id })}
            >
              {accessory.id === "none" ? (
                <BanIcon className="size-6 text-muted-foreground" />
              ) : (
                <BotAccessoryIcon accessory={accessory.id} size={36} />
              )}
            </Tile>
          ))}
        </div>
      </SettingsRow>
    </>
  );
}

function sourceLabel(source: string) {
  if (source === "user") return "Added by you";
  if (source.startsWith("chat:")) return "From chat";
  if (source.startsWith("task:")) return "From a background task";
  return source;
}

function MemorySections({
  bot,
  environmentId,
  projects,
}: {
  readonly bot: Bot;
  readonly environmentId: EnvironmentId;
  readonly projects: ReadonlyArray<EnvironmentProject>;
}) {
  const client = readTasksWebClient(environmentId).bots;
  const canWrite = useExperimentalFeatureRpcPermission(environmentId, BOTS_RPC_METHODS.remember);
  const thread = useThreadShell(scopeThreadRef(environmentId, bot.threadId));
  const [entries, setEntries] = useState<ReadonlyArray<BotMemory>>([]);
  const [proposals, setProposals] = useState<ReadonlyArray<BotMemoryProposal>>([]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let disposed = false;
    Promise.all([
      client.memory({ agentId: bot.agent.id }),
      client.proposals({ agentId: bot.agent.id }),
    ]).then(
      ([memory, suggested]) => {
        if (disposed) return;
        setEntries(memory);
        setProposals(suggested);
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
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Run changes refresh facts saved through MCP while this page stays open.
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
      const [memory, suggested] = await Promise.all([
        client.memory({ agentId: bot.agent.id }),
        client.proposals({ agentId: bot.agent.id }),
      ]);
      setEntries(memory);
      setProposals(suggested);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };
  const scopeName = (projectId: ProjectId | null) =>
    projectId === null
      ? "Global"
      : (projects.find((project) => project.id === projectId)?.title ?? "Unavailable project");
  const meta = (entry: BotMemory) =>
    `${scopeName(entry.projectId)} · ${sourceLabel(entry.source)} · ${formatRelativeTimeLabel(entry.updatedAt)}`;
  const disabled = busy || !canWrite;
  // The same selection the server makes for the bot's chat, so the marks match its context.
  const context = botMemoryContext(entries, bot.projectId);
  const inContext = new Set(context.selected.map((entry) => entry.id));
  const inScope = new Set(context.entries.map((entry) => entry.id));
  const ordered = [...context.entries, ...entries.filter((entry) => !inScope.has(entry.id))];
  return (
    <>
      {proposals.length > 0 ? (
        <SettingsSection
          title="Suggestions"
          titleAction={
            <InfoTip label="About suggestions">
              Facts a background task saved. Tasks can read untrusted pages and files, so they wait
              for your review.
            </InfoTip>
          }
        >
          {proposals.map((proposal) => (
            <MemoryRow
              key={proposal.id}
              meta={meta(proposal)}
              actions={
                <>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={disabled}
                    onClick={() => {
                      void mutate(() =>
                        client.acceptProposal({ agentId: bot.agent.id, id: proposal.id }),
                      );
                    }}
                  >
                    Accept
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => {
                      void mutate(() =>
                        client.rejectProposal({ agentId: bot.agent.id, id: proposal.id }),
                      );
                    }}
                  >
                    Reject
                  </Button>
                </>
              }
            >
              <p className="whitespace-pre-wrap break-words text-sm">{proposal.text}</p>
            </MemoryRow>
          ))}
        </SettingsSection>
      ) : null}
      <SettingsSection
        title="Memory"
        titleAction={
          <InfoTip label="About memory">
            Up to 200 facts. Global facts apply everywhere, project facts only in that project. The
            chat's context holds what fits the budget, your facts first, and the bot reads the rest
            when needed. The bot cannot change or forget facts you wrote.
          </InfoTip>
        }
        headerAction={
          <Button
            size="xs"
            variant="ghost-muted"
            disabled={disabled}
            onClick={() => {
              void mutate(() => client.extract({ agentId: bot.agent.id, requestId: randomUUID() }));
            }}
          >
            Extract from chat history
          </Button>
        }
      >
        {adding ? (
          <NewMemory
            bot={bot}
            scopeName={scopeName}
            busy={busy}
            disabled={!canWrite}
            onCancel={() => setAdding(false)}
            onAdd={(text, projectId) => {
              setAdding(false);
              void mutate(() =>
                client.remember({
                  agentId: bot.agent.id,
                  id: randomUUID(),
                  projectId,
                  text,
                  source: "user",
                }),
              );
            }}
          />
        ) : (
          <div className="px-3 py-2 sm:px-4">
            <Button size="sm" variant="ghost" disabled={!canWrite} onClick={() => setAdding(true)}>
              <PlusIcon />
              Add memory
            </Button>
          </div>
        )}
        {entries.length > 0 ? (
          <MemoryBudget
            used={context.used}
            shown={context.selected.length}
            total={context.entries.length}
          />
        ) : null}
        {ordered.map((entry) => (
          <MemoryEntry
            key={`${entry.id}:${entry.updatedAt}`}
            entry={entry}
            meta={meta(entry)}
            // Entries of other projects reach the bot only in task runs there.
            inContext={inScope.has(entry.id) ? inContext.has(entry.id) : null}
            disabled={!canWrite}
            onSave={(value) => {
              void mutate(() => client.remember({ ...entry, text: value }));
            }}
            onDelete={() => {
              const text = entry.text.length > 200 ? `${entry.text.slice(0, 199)}…` : entry.text;
              void ensureLocalApi()
                .dialogs.confirm(`Delete this memory?\n${text}`, { variant: "destructive" })
                .then((confirmed) => {
                  if (confirmed)
                    void mutate(() => client.forget({ agentId: bot.agent.id, id: entry.id }));
                });
            }}
          />
        ))}
        {entries.length === 0 ? (
          <p className="px-3 py-3 text-sm text-muted-foreground sm:px-4">
            No memories yet. Say “Remember: …” in the chat.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="px-3 py-3 text-sm text-destructive sm:px-4">
            {error}
          </p>
        ) : null}
      </SettingsSection>
    </>
  );
}

/** How much of the context budget the chat's memory snapshot uses. */
function MemoryBudget({
  used,
  shown,
  total,
}: {
  readonly used: number;
  readonly shown: number;
  readonly total: number;
}) {
  return (
    <div className="grid gap-1.5 px-3 py-2.5 sm:px-4">
      <div className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
        <span>
          {shown === total
            ? `All ${total} ${total === 1 ? "memory is" : "memories are"} in the chat's context`
            : `${shown} of ${total} memories are in the chat's context`}
        </span>
        <span className="shrink-0 tabular-nums">
          {used.toLocaleString()} / {BOT_MEMORY_CONTEXT_BUDGET.toLocaleString()} characters
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60"
        role="progressbar"
        aria-label="Memory in the chat's context"
        aria-valuemin={0}
        aria-valuemax={BOT_MEMORY_CONTEXT_BUDGET}
        aria-valuenow={used}
      >
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${Math.min(100, (used / BOT_MEMORY_CONTEXT_BUDGET) * 100)}%` }}
        />
      </div>
    </div>
  );
}

/** One fact as text with its scope, source and age, and its actions at the end. */
function MemoryRow({
  meta,
  marks,
  actions,
  children,
}: {
  readonly meta: string;
  readonly marks?: ReactNode;
  readonly actions: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="group/memory flex items-start gap-3 px-3 py-2.5 sm:px-4">
      <div className="grid min-w-0 flex-1 gap-0.5">
        {children}
        <div className="flex min-w-0 items-center gap-1.5">
          {marks}
          <p className="truncate text-xs text-muted-foreground">{meta}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">{actions}</div>
    </div>
  );
}

/** Enter or leaving the field saves; Shift+Enter starts a new line; Escape cancels. */
function handleMemoryKey(
  event: ReactKeyboardEvent<HTMLTextAreaElement>,
  onSave: () => void,
  onCancel: () => void,
) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    onCancel();
  } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
    event.preventDefault();
    onSave();
  }
}

function MemoryEntry({
  entry,
  meta,
  inContext,
  disabled,
  onSave,
  onDelete,
}: {
  readonly entry: BotMemory;
  readonly meta: string;
  /** Null for entries outside the chat's working project. */
  readonly inContext: boolean | null;
  readonly disabled: boolean;
  readonly onSave: (text: string) => void;
  readonly onDelete: () => void;
}) {
  const [text, setText] = useState<string | null>(null);
  // Saving or cancelling removes the field, which can blur it once more.
  const open = useRef(false);
  const edit = () => {
    open.current = true;
    setText(entry.text);
  };
  const close = (save: boolean) => {
    if (!open.current) return;
    open.current = false;
    const value = text?.trim() ?? "";
    setText(null);
    if (save && value !== "" && value !== entry.text) onSave(value);
  };
  return (
    <MemoryRow
      meta={meta}
      marks={
        <>
          {entry.owner === "user" ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    aria-label="Locked: written by you"
                    className="inline-flex text-muted-foreground"
                  >
                    <LockIcon className="size-3" />
                  </span>
                }
              />
              <TooltipPopup side="top">
                You wrote this, so the bot cannot change or forget it. You can.
              </TooltipPopup>
            </Tooltip>
          ) : null}
          {inContext === null ? null : (
            <Badge size="sm" variant={inContext ? "secondary" : "warning"}>
              {inContext ? "In context" : "Not in context"}
            </Badge>
          )}
        </>
      }
      actions={
        text === null ? (
          <span className="flex gap-0.5 opacity-0 group-focus-within/memory:opacity-100 group-any-hover/memory:opacity-100 pointer-coarse:opacity-100">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost-muted"
                    aria-label="Edit memory"
                    disabled={disabled}
                    onClick={edit}
                  >
                    <PencilIcon />
                  </Button>
                }
              />
              <TooltipPopup side="top">Edit memory</TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost-destructive"
                    aria-label="Delete memory"
                    disabled={disabled}
                    onClick={onDelete}
                  >
                    <Trash2Icon />
                  </Button>
                }
              />
              <TooltipPopup side="top">Delete memory</TooltipPopup>
            </Tooltip>
          </span>
        ) : null
      }
    >
      {text === null ? (
        <button
          type="button"
          disabled={disabled}
          className="cursor-text whitespace-pre-wrap break-words rounded-sm text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={edit}
        >
          {entry.text}
        </button>
      ) : (
        <Textarea
          aria-label="Memory text"
          size="sm"
          autoFocus
          maxLength={2000}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={() => close(true)}
          onKeyDown={(event) =>
            handleMemoryKey(
              event,
              () => close(true),
              () => close(false),
            )
          }
        />
      )}
    </MemoryRow>
  );
}

function NewMemory({
  bot,
  scopeName,
  busy,
  disabled,
  onAdd,
  onCancel,
}: {
  readonly bot: Bot;
  readonly scopeName: (projectId: ProjectId | null) => string;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly onAdd: (text: string, projectId: ProjectId | null) => void;
  readonly onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const [scope, setScope] = useState<string>(bot.projectId);
  const add = () => {
    if (busy || text.trim() === "") return;
    onAdd(text.trim(), scope === "global" ? null : ProjectId.make(scope));
  };
  return (
    <div className="grid gap-2 px-3 py-2.5 sm:px-4">
      <Textarea
        aria-label="New memory"
        size="sm"
        placeholder="Something the bot should remember"
        autoFocus
        maxLength={2000}
        value={text}
        disabled={disabled}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => handleMemoryKey(event, add, onCancel)}
      />
      <div className="flex items-center justify-end gap-2">
        <Select
          value={scope}
          disabled={disabled}
          onValueChange={(value) => {
            if (typeof value === "string") setScope(value);
          }}
        >
          <SelectTrigger aria-label="Memory scope" size="sm" className="w-auto min-w-40">
            <SelectValue>
              {scope === "global"
                ? "Global"
                : scopeName(bot.allowedProjectIds.find((id) => id === scope) ?? null)}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="global">Global</SelectItem>
            {bot.allowedProjectIds.map((projectId) => (
              <SelectItem key={projectId} value={projectId}>
                {scopeName(projectId)}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={disabled || busy || text.trim() === ""} onClick={add}>
          Add
        </Button>
      </div>
    </div>
  );
}

function BackgroundWork({
  bot,
  environmentId,
}: {
  readonly bot: Bot;
  readonly environmentId: EnvironmentId;
}) {
  const canWrite = useExperimentalFeatureRpcPermission(environmentId, BOTS_RPC_METHODS.assign);
  const request = botStatus(useBotTaskRunRequest(environmentId, bot));
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  // Retrying the same assignment after a lost reply must not create a second task.
  const [requestId, setRequestId] = useState(() => randomUUID());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const disabled = busy || !canWrite;
  const cancel = () => {
    setOpen(false);
    setError("");
  };
  const assign = () => {
    if (disabled || title.trim() === "") return;
    setBusy(true);
    setError("");
    void readTasksWebClient(environmentId)
      .bots.assign({ agentId: bot.agent.id, requestId, title, description })
      .then(
        () => {
          setOpen(false);
          setTitle("");
          setDescription("");
          setRequestId(randomUUID());
          toastManager.add({ type: "success", title: "Task assigned" });
        },
        (cause: unknown) => setError(errorText(cause)),
      )
      .finally(() => setBusy(false));
  };
  const onKey = (event: ReactKeyboardEvent<HTMLElement>, submitsOnEnter: boolean) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    } else if (
      event.key === "Enter" &&
      (submitsOnEnter || event.metaKey || event.ctrlKey) &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      assign();
    }
  };
  return (
    <SettingsSection
      title="Tasks"
      titleAction={
        <InfoTip label="About tasks">
          Tasks the bot delegates from its chat, and tasks assigned to the bot itself. Their
          progress and results return to the bot's chat.
        </InfoTip>
      }
    >
      <SettingsRow
        title="Task runs"
        control={
          <span className="flex items-center gap-2 text-sm">
            {request.label ? (
              <Tooltip>
                <TooltipTrigger render={<span className="flex items-center" />}>
                  <ThreadStatusLabel status={request.label} />
                </TooltipTrigger>
                <TooltipPopup side="top">{request.detail}</TooltipPopup>
              </Tooltip>
            ) : null}
            <TaskThreadRunCounts
              environmentId={environmentId}
              threadId={bot.threadId}
              fallback={<span className="text-muted-foreground">None yet</span>}
            />
          </span>
        }
      />
      {open ? (
        <div className="grid gap-2 px-3 py-2.5 sm:px-4">
          <Input
            aria-label="Task title"
            size="sm"
            placeholder="Task title"
            autoFocus
            value={title}
            disabled={disabled}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => onKey(event, true)}
          />
          <Textarea
            aria-label="Task details"
            size="sm"
            placeholder="Details"
            value={description}
            disabled={disabled}
            onChange={(event) => setDescription(event.target.value)}
            onKeyDown={(event) => onKey(event, false)}
          />
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={cancel}>
              Cancel
            </Button>
            <Button size="sm" disabled={disabled || title.trim() === ""} onClick={assign}>
              {busy ? "Assigning…" : "Assign"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="px-3 py-2 sm:px-4">
          <Button size="sm" variant="ghost" disabled={!canWrite} onClick={() => setOpen(true)}>
            <PlusIcon />
            Assign task
          </Button>
        </div>
      )}
      {error ? (
        <p role="alert" className="px-3 py-3 text-sm text-destructive sm:px-4">
          {error}
        </p>
      ) : null}
    </SettingsSection>
  );
}
