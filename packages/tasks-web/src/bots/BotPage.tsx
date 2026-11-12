import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useCanGoBack, useLocation, useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon, BanIcon, DicesIcon, InfoIcon, XIcon } from "lucide-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { describeError } from "@t3tools/client-runtime/errors";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  DEFAULT_RUNTIME_MODE,
  EnvironmentId,
  ProjectId,
  ThreadId,
  type ModelSelection,
  type RuntimeMode,
  type ServerProvider,
} from "@t3tools/contracts";
import {
  BOTS_RPC_METHODS,
  botMemoryContext,
  TaskAgentId,
  type Bot,
  type BotAppearance,
  type BotMemory,
  type BotWriteInput,
  defaultBotAppearance,
} from "@t3tools/tasks-contracts/v1";
import {
  useProjects,
  useServerConfigs,
  useThreadShell,
  waitForThreadShell,
} from "../../../../apps/web/src/state/entities.ts";
import {
  useEnvironmentProviders,
  usePrimaryEnvironmentId,
} from "../../../../apps/web/src/state/environments.ts";
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
import {
  ErrorDetails,
  errorToastDescription,
} from "../../../../apps/web/src/components/errors/ErrorDetails.tsx";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../../../../apps/web/src/components/ui/alert-dialog.tsx";
import { Button } from "../../../../apps/web/src/components/ui/button.tsx";
import { Input } from "../../../../apps/web/src/components/ui/input.tsx";
import { Textarea } from "../../../../apps/web/src/components/ui/textarea.tsx";
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
import {
  BotAccessoryIcon,
  ConfigurableBotCharacter,
  botAppearanceCatalog,
} from "../../../../apps/web/src/components/bot-character-configurable/ConfigurableBotCharacter.tsx";
import { useExperimentalFeatureRpcPermission } from "../../../../apps/web/src/extensionApi.ts";
import { formatRelativeTimeLabel } from "../../../../apps/web/src/timestampFormat.ts";
import { ensureLocalApi } from "../../../../apps/web/src/localApi.ts";
import { cn, randomUUID } from "../../../../apps/web/src/lib/utils.ts";
import { readTasksWebClient } from "../environmentApi.ts";
import { WorkspaceViewLayout } from "../ui/WorkspaceViewLayout.tsx";
import { useAutosave } from "./botAutosave.ts";
import {
  botsChanged,
  errorCode,
  errorReason,
  errorText,
  useBots,
  useBotStatus,
} from "./botData.tsx";
import { type BotCharacterState } from "./botStatus.ts";

const NO_SERVER_PROVIDERS: ReadonlyArray<ServerProvider> = [];

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
  // A rename made elsewhere, such as in the chat or by an agent, shows here unless the field
  // holds typing not saved yet. Left stale, the next save of another field would undo it.
  const [savedName, setSavedName] = useState(bot?.agent.name);
  if (bot && bot.agent.name !== savedName) {
    setSavedName(bot.agent.name);
    if (name === savedName) setName(bot.agent.name);
  }
  const [appearance, setAppearance] = useState<BotAppearance>(
    () => bot?.appearance ?? defaultBotAppearance(id),
  );
  const [instructions, setInstructions] = useState(
    bot?.agent.config.instructions ??
      "Help the user, remember useful facts, and keep them informed about your work.",
  );
  const initialProject = bot?.projectId ?? source?.projectId ?? projects[0]?.id ?? null;
  const [projectId, setProjectId] = useState<ProjectId | null>(initialProject);
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
  const [error, setError] = useState<unknown>(null);
  // Why the chat could not become a bot, shown in a dialog.
  const [adoptRefusal, setAdoptRefusal] = useState<string | null>(null);
  const [removal, setRemoval] = useState<number | null>(null);
  const canWrite = useExperimentalFeatureRpcPermission(environmentId, BOTS_RPC_METHODS.save);
  const providersByEnvironment = useEnvironmentProviders();
  const configs = useServerConfigs();
  const settings = usePrimarySettings();
  const serverProviders = providersByEnvironment.get(environmentId) ?? NO_SERVER_PROVIDERS;
  const providers = useMemo(
    () => deriveProviderInstanceEntries(serverProviders),
    [serverProviders],
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
    projectId !== null
      ? {
          id,
          ...(threadId ? { threadId } : {}),
          projectId,
          // The bot lives in one project; its memory is global or that project's.
          allowedProjectIds: [projectId],
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
  // The failure toast's Retry runs after render, once `autosave` exists.
  const retrySave = useRef(() => {});
  // An existing bot saves as it changes; a new one waits for Create.
  const autosave = useAutosave(bot ? draft : null, async (input) => {
    try {
      await client.save(input);
      setError(null);
      botsChanged();
    } catch (cause) {
      setError(cause);
      toastManager.add({
        type: "error",
        title: "Couldn't save the bot",
        description: errorToastDescription(
          cause,
          undefined,
          `Couldn't save ${input.name}'s settings: ${errorReason(cause)}. Try again.`,
        ),
        actionProps: { children: "Retry", onClick: () => retrySave.current() },
      });
      throw cause;
    }
  });
  useEffect(() => {
    retrySave.current = () => autosave.schedule(0);
  }, [autosave]);
  const textKey = JSON.stringify([name, instructions]);
  const choiceKey = JSON.stringify([appearance, selection, runtimeMode, projectId]);
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
    setError(null);
    try {
      await run();
      botsChanged();
    } catch (cause) {
      if (errorCode(cause) === "bot_chat_unavailable") setAdoptRefusal(errorText(cause));
      else setError(cause);
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
  const restoreNotices = (configs.get(environmentId)?.backgroundNotices ?? []).filter(
    (notice) => notice.id === `bots:restore:${id}` || notice.id === `bots:name:${id}`,
  );
  const remove = () => {
    if (!bot) return;
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
  };

  return (
    <WorkspaceViewLayout
      title={bot ? bot.agent.name : threadId ? "Turn into bot" : "New bot"}
      onNavigateBack={onBack}
      navigateOnEscape={false}
      inset={false}
      leadingAction={{
        ariaLabel: "Back",
        track: "bots.back",
        icon: <ArrowLeftIcon className="size-4" />,
        onClick: onBack,
      }}
      action={
        bot
          ? undefined
          : {
              ariaLabel: "Create bot",
              track: "bots.create_save",
              label: busy ? "Creating…" : "Create bot",
              hideIcon: true,
              disabled: !editable || draft === null,
              onClick: create,
            }
      }
    >
      <WorkspacePageContainer>
        <BotError error={error} className="px-3 sm:px-4" />
        {bot && restoreNotices.length > 0 ? (
          <SettingsSection title="Problems" hideTitle>
            {restoreNotices.map((notice) => (
              <SettingsRow
                key={notice.id}
                title={notice.title}
                description={notice.message}
                control={
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!editable || draft === null}
                    onClick={() => {
                      if (draft) void act(() => client.save(draft));
                    }}
                  >
                    Save again
                  </Button>
                }
              >
                <div className="pb-2">
                  <ErrorDetails detail={notice.detail} />
                </div>
              </SettingsRow>
            ))}
          </SettingsSection>
        ) : null}
        <SettingsSection title="Appearance">
          <div className="relative flex flex-col items-center gap-2 px-3 pt-6 pb-4 sm:px-4">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost-muted"
                    className="absolute top-3 right-3"
                    aria-label="Randomize appearance"
                    disabled={!editable}
                    onClick={() => {
                      const { shapes, colors, accessories } = botAppearanceCatalog;
                      setAppearance({
                        shape: shapes[Math.floor(Math.random() * shapes.length)]!.id,
                        color: colors[Math.floor(Math.random() * colors.length)]!.id,
                        accessory: accessories[Math.floor(Math.random() * accessories.length)]!.id,
                      });
                    }}
                  >
                    <DicesIcon />
                  </Button>
                }
              />
              <TooltipPopup side="top">Randomize appearance</TooltipPopup>
            </Tooltip>
            <CharacterPreview appearance={appearance} state={status.state} />
            <div className="w-full max-w-sm text-lg font-semibold [&_input]:text-center">
              <Input
                unstyled
                aria-label="Name"
                placeholder="Name"
                value={name}
                disabled={!editable}
                aria-invalid={name.trim() === ""}
                onChange={(event) => setName(event.target.value)}
                onBlur={saveNow}
              />
            </div>
          </div>
          <AppearancePicker
            appearance={appearance}
            disabled={!editable}
            onAppearanceChange={setAppearance}
          />
        </SettingsSection>

        <SettingsSection title="Instructions" hideTitle>
          <SettingsRow title="Instructions">
            <div className="pt-1 pb-2 text-sm text-foreground [&_textarea]:resize-none [&_textarea]:px-0">
              <Textarea
                unstyled
                aria-label="Instructions"
                placeholder="What the bot does and how"
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
                      onPromptEdit={setInstructions}
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

        <SettingsSection id={PROJECTS_SECTION_ID} title="Project" hideTitle>
          <SettingsRow
            title="Project"
            description="Where the bot works. Its chat moves with it, and its memory stays the same."
            control={
              <Select
                value={projectId ?? ""}
                disabled={!editable || projects.length === 0}
                onValueChange={(value) => {
                  const next = projects.find((project) => project.id === value);
                  if (next) setProjectId(next.id);
                }}
              >
                <SelectTrigger aria-label="Project" className="min-w-48">
                  <SelectValue>
                    {(() => {
                      const project = projects.find((item) => item.id === projectId);
                      return project ? <ProjectLabel project={project} /> : "Choose a project";
                    })()}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      <ProjectLabel project={project} />
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          />
        </SettingsSection>

        {bot ? (
          <>
            <MemorySections bot={bot} environmentId={environmentId} />
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
                      void client.memory({ agentId: id }).then(
                        (entries) => setRemoval(entries.length),
                        (cause: unknown) => setError(cause),
                      );
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
      <AlertDialog
        open={removal !== null}
        onOpenChange={(open) => {
          if (!open) setRemoval(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete bot and its memory?</AlertDialogTitle>
            <AlertDialogDescription>
              {bot?.agent.name} is a bot. Deleting it also deletes its {removal}{" "}
              {removal === 1 ? "memory" : "memories"}, and its chat becomes a normal chat.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setRemoval(null);
                remove();
              }}
            >
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
      <AlertDialog
        open={adoptRefusal !== null}
        onOpenChange={(open) => {
          if (!open) setAdoptRefusal(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Can't use this chat</AlertDialogTitle>
            <AlertDialogDescription>{adoptRefusal}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>OK</AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </WorkspaceViewLayout>
  );
}

const PROJECTS_SECTION_ID = "bot-projects";

/** A failed bot action: plain words, with the raw error behind Details. */
function BotError({ error, className }: { readonly error: unknown; readonly className: string }) {
  if (error === null) return null;
  return (
    <div role="alert" className={cn("grid gap-1", className)}>
      <p className="text-sm text-destructive">{errorText(error)}</p>
      <ErrorDetails detail={describeError(error).detail} />
    </div>
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
  return (
    <span className="flex size-30 shrink-0 items-center justify-center">
      <ConfigurableBotCharacter appearance={appearance} state={state} size={120} decorative />
    </span>
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

function MemorySections({
  bot,
  environmentId,
}: {
  readonly bot: Bot;
  readonly environmentId: EnvironmentId;
}) {
  const client = readTasksWebClient(environmentId).bots;
  const canWrite = useExperimentalFeatureRpcPermission(environmentId, BOTS_RPC_METHODS.remember);
  const thread = useThreadShell(scopeThreadRef(environmentId, bot.threadId));
  // Null until the first read returns, so the empty line does not flash before it.
  const [entries, setEntries] = useState<ReadonlyArray<BotMemory> | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let disposed = false;
    client.memory({ agentId: bot.agent.id }).then(
      (memory) => {
        if (!disposed) setEntries(memory);
      },
      (cause: unknown) => {
        if (!disposed) setError(cause);
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
  ]);
  const mutate = async (run: () => Promise<unknown>) => {
    setError(null);
    try {
      await run();
      setEntries(await client.memory({ agentId: bot.agent.id }));
    } catch (cause) {
      setError(cause);
    }
  };
  // The same selection the server makes for the bot's chat, so the marks match its context.
  const context = botMemoryContext(entries ?? []);
  const inContext = new Set(context.selected.map((entry) => entry.id));
  return (
    <SettingsSection
      title="Memory"
      titleAction={
        <InfoTip label="About memory">
          Up to 200 facts the bot saves in its chat. The chat's context holds what fits the budget,
          your facts first, and the bot reads the rest when needed. The bot cannot change or forget
          facts you edited.
        </InfoTip>
      }
    >
      {context.selected.length < context.entries.length ? (
        <p className="px-3 pt-3 pb-1 text-xs text-muted-foreground sm:px-4">
          {context.entries.length - context.selected.length} of {context.entries.length} facts
          don&apos;t fit the chat&apos;s context. The bot can still look them up.
        </p>
      ) : null}
      {context.entries.map((entry) => (
        <MemoryEntry
          key={`${entry.id}:${entry.updatedAt}`}
          entry={entry}
          inContext={inContext.has(entry.id)}
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
      {entries?.length === 0 ? (
        <p className="px-3 py-3 text-sm text-muted-foreground sm:px-4">
          No memories yet. Say “Remember: …” in the chat.
        </p>
      ) : null}
      <BotError error={error} className="px-3 py-3 sm:px-4" />
    </SettingsSection>
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

/** One fact: click the text to edit it in place; delete shows on hover. */
function MemoryEntry({
  entry,
  inContext,
  disabled,
  onSave,
  onDelete,
}: {
  readonly entry: BotMemory;
  /** Facts past the context budget reach the bot only when it looks them up. */
  readonly inContext: boolean;
  readonly disabled: boolean;
  readonly onSave: (text: string) => void;
  readonly onDelete: () => void;
}) {
  const [text, setText] = useState<string | null>(null);
  // Saving or cancelling removes the field, which can blur it once more.
  const open = useRef(false);
  const editing = text !== null;
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
    <div
      className={cn(
        "group/memory flex items-start gap-3 px-3 py-2.5 sm:px-4",
        editing && "bg-muted/40",
      )}
    >
      <div className="grid min-w-0 flex-1 gap-0.5">
        {editing ? (
          <div className="text-sm text-foreground [&_textarea]:min-h-0 [&_textarea]:resize-none [&_textarea]:p-0">
            <Textarea
              unstyled
              aria-label="Memory text"
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
          </div>
        ) : (
          <button
            type="button"
            disabled={disabled}
            className={cn(
              "cursor-text whitespace-pre-wrap break-words text-left text-sm outline-none",
              !inContext && "text-muted-foreground",
            )}
            onClick={edit}
          >
            {entry.text}
          </button>
        )}
        <p className="truncate text-xs text-muted-foreground">
          {editing ? "Enter to save · Esc to cancel" : formatRelativeTimeLabel(entry.updatedAt)}
        </p>
      </div>
      {editing ? null : (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost-muted"
                aria-label="Delete memory"
                disabled={disabled}
                className="opacity-0 group-focus-within/memory:opacity-100 group-any-hover/memory:opacity-100 pointer-coarse:opacity-100"
                onClick={onDelete}
              >
                <XIcon />
              </Button>
            }
          />
          <TooltipPopup side="top">Delete memory</TooltipPopup>
        </Tooltip>
      )}
    </div>
  );
}
