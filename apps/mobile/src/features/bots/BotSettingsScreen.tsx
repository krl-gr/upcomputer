import { useNavigation, useRoute, type StaticScreenProps } from "@react-navigation/native";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  DEFAULT_RUNTIME_MODE,
  EnvironmentId,
  ThreadId,
  type ModelSelection,
  type ProjectId,
  type RuntimeMode,
} from "@t3tools/contracts";
import { buildTraitsTriggerDisplay } from "@t3tools/client-runtime/model-traits";
import { createAutosave } from "@t3tools/tasks-client/bots/botAutosave";
import {
  botWriteInput,
  DEFAULT_BOT_INSTRUCTIONS,
  randomBotAppearance,
} from "@t3tools/tasks-client/bots/botForm";
import {
  defaultBotAppearance,
  TaskAgentId,
  type BotMemoryMode,
  type BotWriteInput,
} from "@t3tools/tasks-contracts/v1";
import { useGT, useMessages } from "gt-react-native";
import { useEffect, useState, type ReactNode } from "react";
import { Keyboard, Pressable, View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Stop } from "react-native-svg";

import * as Dialog from "../../components/ui/Dialog";
import type { SFSymbol } from "../../components/ui/AppSymbol";
import { UpIcon, type UpIconName } from "../../components/up-icons/UpIcon";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { FitSheet } from "../../components/ui/FitSheet";
import { ListSection } from "../../components/ui/ListSection";
import { Menu } from "../../components/ui/Menu";
import { SheetHeader } from "../../components/ui/SheetHeader";
import { cn } from "../../lib/cn";
import { buildModelOptions, resolveNewTaskModelSelection } from "../../lib/modelOptions";
import { resolveProviderOptionDescriptors } from "../../lib/providerOptions";
import { uuidv4 } from "../../lib/uuid";
import { useEnvironmentServerConfig, useProjects, useThreadShell } from "../../state/entities";
import { useWorkspaceState } from "../../state/workspace";
import { useSelectWorkspaceDetail } from "../layout/workspace/useSelectWorkspaceDetail";
import { readTasksClient, useTasksAccess } from "../tasks/tasksRpc";
import { waitForThreadShell } from "../threads/threadForkNavigation";
import {
  RUNTIME_MODE_CHOICES,
  runtimeModeChoicesForSupportedModes,
} from "../threads/thread-settings-options";
import { BotAccessoryIcon } from "./character/BotAccessoryIcon";
import { BotCharacter } from "./character/BotCharacter";
import {
  BOT_ACCESSORIES,
  BOT_ACCESSORY_LABELS,
  BOT_COLOR_LABELS,
  BOT_SHAPE_LABELS,
} from "./character/appearanceLabels";
import { botColors, botShapes } from "./character/catalog";
import { changeBotForm, forgetBotForm, useBotFormChanges } from "./botFormStore";
import { botLists, useBotSections } from "./botsData";

export type BotSettingsParams = {
  readonly environmentId: string;
  /** A saved bot's settings; left out for New bot. */
  readonly agentId?: string;
  /** Turn into bot: the chat the new bot adopts, as on the desktop. */
  readonly threadId?: string;
};

/** For the native menu's items, which take SF Symbols only. */
const RUNTIME_MODE_ICONS: Record<RuntimeMode, SFSymbol> = {
  "approval-required": "lock",
  "auto-accept-edits": "pencil.line",
  auto: "checkmark.shield",
  "full-access": "shield.slash",
};

const RUNTIME_MODE_ROW_ICONS: Record<RuntimeMode, UpIconName> = {
  "approval-required": "lock",
  "auto-accept-edits": "edit",
  auto: "shield-check",
  "full-access": "shield-off",
};

const errorMessage = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
const errorCode = (cause: unknown) =>
  typeof cause === "object" && cause !== null && "code" in cause ? cause.code : undefined;

/** Saves a saved bot's settings as they change, as the desktop's bot page does. */
function useAutosave(value: BotWriteInput | null, write: (value: BotWriteInput) => Promise<void>) {
  const [autosave] = useState(() => createAutosave(value, write));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hands this render's form to the autosaver before the scheduling effects run
  useEffect(() => autosave.update(value, write));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a change still waiting to save goes out when the sheet closes
  useEffect(
    () => () => {
      void autosave.flush();
    },
    [autosave],
  );
  return autosave;
}

/**
 * The desktop's bot page as a sheet: New bot, or a saved bot's settings. Sections in the
 * desktop's order: Appearance, Instructions, Model and Permissions, Project; a saved bot adds
 * Memory and Remove.
 */
export function BotSettingsScreen({ route }: StaticScreenProps<BotSettingsParams>) {
  const gt = useGT();
  const m = useMessages();
  const navigation = useNavigation();
  const formKey = useRoute().key;
  const selectDetail = useSelectWorkspaceDetail();
  const environmentId = EnvironmentId.make(route.params.environmentId);
  const { environments } = useWorkspaceState();
  const environment = environments.find((entry) => entry.environmentId === environmentId);
  const connected = environment?.connectionState === "connected";
  const access = useTasksAccess(connected ? environmentId : null);
  const section = useBotSections([environmentId])[0];
  const threadId =
    route.params.threadId === undefined ? undefined : ThreadId.make(route.params.threadId);
  const source = useThreadShell(threadId ? scopeThreadRef(environmentId, threadId) : null);
  // A chat that already is a bot opens that bot's settings, as on the desktop.
  const bot =
    section?.state !== "ready"
      ? undefined
      : section.bots.find((entry) =>
          route.params.agentId !== undefined
            ? entry.agent.id === route.params.agentId
            : threadId !== undefined && entry.threadId === threadId,
        );
  const missing = route.params.agentId !== undefined && section?.state === "ready" && !bot;
  // Turn into bot waits for the list, which may show the chat is a bot already.
  const waitingForBots = threadId !== undefined && section?.state !== "ready";
  const client = readTasksClient(environmentId).bots;
  const [newId] = useState(() =>
    TaskAgentId.make(route.params.agentId ?? `bot:${threadId ?? uuidv4()}`),
  );
  const id = bot?.agent.id ?? newId;
  const changes = useBotFormChanges(formKey);
  const change = (patch: Parameters<typeof changeBotForm>[1]) => changeBotForm(formKey, patch);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the form's changes live in a store the model picker shares; they go with the sheet
  useEffect(() => () => forgetBotForm(formKey), [formKey]);

  // A chat without a project keeps its own: the server keeps a chat's worktree in its project.
  const projects = useProjects()
    .filter(
      (project) =>
        project.environmentId === environmentId &&
        (project.isScratch !== true || project.id === source?.projectId),
    )
    .sort((left, right) => left.title.localeCompare(right.title));
  const sourceProjectId = projects.some((entry) => entry.id === source?.projectId)
    ? source?.projectId
    : undefined;
  const projectId: ProjectId | null =
    changes.projectId ?? bot?.projectId ?? sourceProjectId ?? projects[0]?.id ?? null;
  const project = projects.find((entry) => entry.id === projectId) ?? null;
  const serverConfig = useEnvironmentServerConfig(environmentId);
  const modelOptions = buildModelOptions(
    serverConfig,
    changes.selection ?? bot?.agent.config.modelSelection ?? source?.modelSelection ?? null,
    undefined,
    projectId,
  );
  const selection: ModelSelection | undefined =
    changes.selection ??
    bot?.agent.config.modelSelection ??
    source?.modelSelection ??
    resolveNewTaskModelSelection({
      draftSelection: null,
      projectDefaultSelection: project?.defaultModelSelection ?? null,
      stickySelection: null,
      modelOptions,
    }) ??
    undefined;
  const selectedOption = selection
    ? modelOptions.find(
        (option) =>
          option.selection.instanceId === selection.instanceId &&
          option.selection.model === selection.model,
      )
    : undefined;
  const form = {
    id,
    ...(threadId && !bot ? { threadId } : {}),
    name: changes.name ?? bot?.agent.name ?? source?.title ?? gt("New bot"),
    appearance: changes.appearance ?? bot?.appearance ?? defaultBotAppearance(id),
    instructions:
      changes.instructions ?? bot?.agent.config.instructions ?? DEFAULT_BOT_INSTRUCTIONS,
    projectId,
    selection,
    // A chat turned into a bot keeps its permissions; a new bot gets a new thread's.
    runtimeMode:
      changes.runtimeMode ??
      bot?.agent.config.runtimeMode ??
      source?.runtimeMode ??
      DEFAULT_RUNTIME_MODE,
    memoryMode: changes.memoryMode ?? bot?.memoryMode ?? ("upcomputer" as BotMemoryMode),
  };
  const draft = botWriteInput(form, bot?.agent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canWrite = connected && access?.canMutateAgents === true;
  const editable = canWrite && !busy && !missing;

  // A saved bot saves as it changes; a new one waits for Create bot.
  const autosave = useAutosave(bot ? draft : null, async (input) => {
    try {
      await client.save(input);
      setError(null);
      botLists.refreshShown();
    } catch (cause) {
      setError(
        gt("Couldn't save {name}'s settings: {reason}. Try again.", {
          name: input.name,
          reason: errorMessage(cause),
        }),
      );
      throw cause;
    }
  });
  const textKey = JSON.stringify([form.name, form.instructions]);
  const choiceKey = JSON.stringify([
    form.appearance,
    form.selection,
    form.runtimeMode,
    form.projectId,
    form.memoryMode,
  ]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- text saves to the computer after a pause in typing
  useEffect(() => {
    autosave.schedule(800);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- The key is the change that schedules a save.
  }, [autosave, textKey]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a pick saves to the computer at once
  useEffect(() => {
    autosave.schedule(0);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- The key is the change that schedules a save.
  }, [autosave, choiceKey]);
  const saveNow = () => autosave.schedule(0);

  const openChat = (threadId: string) => {
    navigation.goBack();
    selectDetail({ name: "Thread", params: { environmentId: String(environmentId), threadId } });
  };
  const create = async () => {
    if (!draft || busy) return;
    Keyboard.dismiss();
    setBusy(true);
    setError(null);
    const saved = await client.save(draft).catch((cause: unknown) => {
      if (errorCode(cause) === "bot_chat_unavailable")
        Dialog.alert(gt("Can't use this chat"), errorMessage(cause));
      else setError(errorMessage(cause));
      return null;
    });
    if (saved !== null) botLists.refreshShown();
    const ready =
      saved !== null && (await waitForThreadShell(scopeThreadRef(environmentId, saved.threadId)));
    setBusy(false);
    if (saved === null) return;
    if (!ready) {
      setError(
        gt(
          "The bot was saved, but its chat has not reached this client. Reconnect and open it from Bots.",
        ),
      );
      return;
    }
    openChat(String(saved.threadId));
  };
  const remove = () => {
    if (!bot) return;
    void client.memory({ agentId: id }).then(
      (entries) =>
        Dialog.confirm({
          title: gt("Delete bot and its memory?"),
          message: gt(
            "{name} is a bot. Deleting it also deletes its {count, plural, one {# memory} other {# memories}}, and its chat becomes a normal chat.",
            { name: bot.agent.name, count: entries.length },
          ),
          confirmText: gt("Delete"),
          destructive: true,
          onConfirm: () => {
            // A save that lands after removal would recreate the bot.
            const saving = autosave.stop();
            setBusy(true);
            void saving
              .then(() => client.remove({ agentId: id }))
              .then(
                () => {
                  botLists.refreshShown();
                  openChat(String(bot.threadId));
                },
                (cause: unknown) => {
                  autosave.resume();
                  setError(errorMessage(cause));
                },
              )
              .finally(() => setBusy(false));
          },
        }),
      (cause: unknown) => setError(errorMessage(cause)),
    );
  };

  // As the composer's model control: the model, then its traits, such as the effort.
  const traits = selectedOption
    ? buildTraitsTriggerDisplay(
        {
          descriptors: resolveProviderOptionDescriptors({
            capabilities: selectedOption.capabilities,
            selections: selection?.options,
          }),
          primarySelectDescriptorId: null,
          ultrathinkPromptControlled: false,
          modelSelection: selection ?? null,
          reportedModelSelection: null,
        },
        m,
      ).label
    : "";
  const modelLabel = selectedOption
    ? [selectedOption.providerLabel, selectedOption.label, traits].filter(Boolean).join(" · ")
    : null;
  const runtimeChoices = runtimeModeChoicesForSupportedModes(selectedOption?.supportedRuntimeModes);
  const runtimeChoice =
    RUNTIME_MODE_CHOICES.find((choice) => choice.mode === form.runtimeMode) ??
    RUNTIME_MODE_CHOICES[0]!;
  const memoryModes: Record<BotMemoryMode, { label: string; description: string }> = {
    upcomputer: {
      label: gt("Up.computer memory"),
      description: gt("Up.computer saves facts and gives them to the bot in every chat."),
    },
    agent: {
      label: gt("Managed by the agent"),
      description: gt(
        "For agents with a memory of their own. Up.computer doesn't save or send facts.",
      ),
    },
  };

  return (
    <FitSheet
      avoidsKeyboard
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 }}
      contentContainerClassName="gap-6"
      header={
        <SheetHeader
          title={bot ? bot.agent.name : threadId ? gt("Turn into bot") : gt("New bot")}
          subtitle={environment?.environmentLabel ?? ""}
          onClose={() => navigation.goBack()}
          dismissDisabled={busy}
          {...(bot || missing
            ? {}
            : {
                confirm: {
                  label: busy ? gt("Creating…") : gt("Create bot"),
                  onPress: () => void create(),
                  disabled: !editable || draft === null || waitingForBots,
                  loading: busy,
                },
              })}
        />
      }
    >
      {missing ? (
        <Text className="text-sm text-foreground-muted">{gt("This bot no longer exists.")}</Text>
      ) : null}
      {!canWrite && !missing ? (
        <Text className="text-sm text-foreground-muted">
          {connected
            ? gt("This computer doesn't let this device change bots.")
            : gt("Reconnect to this computer to change its bots.")}
        </Text>
      ) : null}
      {error ? (
        <Text selectable accessibilityRole="alert" className="text-sm text-danger-foreground">
          {error}
        </Text>
      ) : null}

      <ListSection title={gt("Appearance")}>
        <View className="items-center gap-2 px-4 pt-6 pb-4">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={gt("Randomize appearance")}
            disabled={!editable}
            hitSlop={8}
            onPress={() => change({ appearance: randomBotAppearance() })}
            className="absolute top-3 right-3 size-11 items-center justify-center rounded-full active:bg-subtle disabled:opacity-40"
          >
            <UpIcon name="dice-roll" size={24} tintColorClassName="accent-icon-muted" />
          </Pressable>
          <BotCharacter id={id} appearance={form.appearance} size={100} />
          <TextInput
            accessibilityLabel={gt("Name")}
            placeholder={gt("Name")}
            placeholderTextColorClassName="accent-foreground-muted"
            editable={editable}
            value={form.name}
            onChangeText={(name) => change({ name })}
            onBlur={saveNow}
            className="min-h-11 w-full border-0 bg-transparent py-1 text-center text-xl font-t3-bold text-foreground"
          />
        </View>
        <PickerRow title={gt("Shape")}>
          {botShapes.map((shape) => (
            <Tile
              key={shape.id}
              label={m(BOT_SHAPE_LABELS[shape.id])}
              selected={form.appearance.shape === shape.id}
              disabled={!editable}
              onSelect={() => change({ appearance: { ...form.appearance, shape: shape.id } })}
            >
              <BotCharacter
                id={id}
                appearance={{ ...form.appearance, shape: shape.id, accessory: "none" }}
                size={27}
              />
            </Tile>
          ))}
        </PickerRow>
        <PickerRow title={gt("Color")}>
          {botColors.map((color) => (
            <Tile
              key={color.id}
              label={m(BOT_COLOR_LABELS[color.id])}
              round
              selected={form.appearance.color === color.id}
              disabled={!editable}
              onSelect={() => change({ appearance: { ...form.appearance, color: color.id } })}
            >
              <ColorDot id={color.id} fill={color.fill} shade={color.shade} />
            </Tile>
          ))}
        </PickerRow>
        <PickerRow title={gt("Accessories")}>
          {BOT_ACCESSORIES.map((accessory) => (
            <Tile
              key={accessory}
              label={m(BOT_ACCESSORY_LABELS[accessory])}
              selected={form.appearance.accessory === accessory}
              disabled={!editable}
              onSelect={() => change({ appearance: { ...form.appearance, accessory } })}
            >
              {accessory === "none" ? (
                <UpIcon name="no-entry" size={28} tintColorClassName="accent-icon-muted" />
              ) : (
                <BotAccessoryIcon accessory={accessory} size={36} />
              )}
            </Tile>
          ))}
        </PickerRow>
      </ListSection>

      <ListSection>
        <View className="gap-1 px-4 pt-3 pb-2">
          <Text className="text-base font-t3-medium text-foreground">{gt("Instructions")}</Text>
          <TextInput
            multiline
            accessibilityLabel={gt("Instructions")}
            placeholder={gt("What the bot does and how")}
            placeholderTextColorClassName="accent-foreground-muted"
            editable={editable}
            value={form.instructions}
            onChangeText={(instructions) => change({ instructions })}
            onBlur={saveNow}
            className="min-h-24 border-0 bg-transparent px-0 py-1 text-base text-foreground"
            style={{ textAlignVertical: "top" }}
          />
        </View>
      </ListSection>

      <ListSection>
        <SettingRow
          title={gt("Model")}
          value={modelLabel ?? gt("Configure a provider first")}
          disabled={!editable || selection === undefined}
          onPress={() => {
            Keyboard.dismiss();
            navigation.navigate("BotModel", {
              formKey,
              environmentId: String(environmentId),
              ...(projectId === null ? {} : { projectId: String(projectId) }),
              ...(selection === undefined ? {} : { selection }),
              runtimeMode: form.runtimeMode,
            });
          }}
        />
        <Divider />
        <MenuRow
          title={gt("Permissions")}
          description={gt("For the bot's chat and its background tasks.")}
          value={m(runtimeChoice.label)}
          icon={RUNTIME_MODE_ROW_ICONS[runtimeChoice.mode]}
          disabled={!editable}
          options={runtimeChoices.map((choice) => ({
            id: choice.mode,
            title: m(choice.label),
            subtitle: m(choice.description),
            image: RUNTIME_MODE_ICONS[choice.mode],
          }))}
          selected={form.runtimeMode}
          onSelect={(mode) => change({ runtimeMode: mode as RuntimeMode })}
        />
      </ListSection>

      <ListSection>
        <MenuRow
          title={gt("Project")}
          description={gt(
            "Where the bot works. Its chat moves with it, and its memory stays the same.",
          )}
          value={project?.title ?? gt("Choose a project")}
          disabled={!editable || projects.length === 0}
          options={projects.map((entry) => ({ id: String(entry.id), title: entry.title }))}
          selected={projectId === null ? "" : String(projectId)}
          onSelect={(next) =>
            change({ projectId: projects.find((entry) => String(entry.id) === next)?.id ?? null })
          }
        />
      </ListSection>

      {bot ? (
        <>
          <ListSection title={gt("Memory")}>
            <MenuRow
              title={gt("Who keeps memory")}
              description={memoryModes[form.memoryMode].description}
              value={memoryModes[form.memoryMode].label}
              disabled={!editable}
              options={(["upcomputer", "agent"] as const).map((mode) => ({
                id: mode,
                title: memoryModes[mode].label,
                subtitle: memoryModes[mode].description,
              }))}
              selected={form.memoryMode}
              onSelect={(mode) => change({ memoryMode: mode as BotMemoryMode })}
            />
            <Divider />
            <SettingRow
              title={gt("Memory")}
              value=""
              onPress={() =>
                navigation.navigate("BotMemory", {
                  environmentId: String(environmentId),
                  agentId: String(bot.agent.id),
                  name: bot.agent.name,
                })
              }
            />
          </ListSection>
          <ListSection title={gt("Remove", { $context: "settings section that removes a bot" })}>
            <Pressable
              accessibilityRole="button"
              accessibilityHint={gt("Deletes its memory. Its chat returns to Threads.")}
              disabled={!editable}
              onPress={remove}
              className="min-h-14 justify-center gap-0.5 px-4 py-3 active:bg-subtle disabled:opacity-45"
            >
              <Text className="text-base text-danger-foreground">{gt("Remove bot")}</Text>
              <Text className="text-sm text-foreground-muted">
                {gt("Deletes its memory. Its chat returns to Threads.")}
              </Text>
            </Pressable>
          </ListSection>
        </>
      ) : null}
    </FitSheet>
  );
}

function Divider() {
  return <View className="ml-4 h-px bg-border-subtle" />;
}

function PickerRow(props: { readonly title: string; readonly children: ReactNode }) {
  return (
    <View className="gap-2 border-t border-border-subtle px-4 pt-3 pb-3">
      <Text className="text-base font-t3-medium text-foreground">{props.title}</Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={props.title}
        className="flex-row flex-wrap gap-1"
      >
        {props.children}
      </View>
    </View>
  );
}

/** A picture option, as the desktop's tiles: square for shapes and accessories, round for colors. */
function Tile(props: {
  readonly label: string;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly round?: boolean;
  readonly onSelect: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={props.label}
      accessibilityState={{ checked: props.selected, disabled: props.disabled }}
      disabled={props.disabled}
      onPress={props.onSelect}
      className={cn(
        "items-center justify-center border active:opacity-60 disabled:opacity-40",
        props.round ? "size-11 rounded-full" : "size-12 rounded-xl",
        props.selected
          ? props.round
            ? "border-foreground-muted"
            : "border-border bg-subtle"
          : "border-transparent",
      )}
    >
      {props.children}
    </Pressable>
  );
}

function ColorDot(props: { readonly id: string; readonly fill: string; readonly shade: string }) {
  const gradient = `bot-color-${props.id}`;
  return (
    <Svg width={32} height={32} viewBox="0 0 32 32">
      <Defs>
        <LinearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={props.fill} />
          <Stop offset="1" stopColor={props.shade} />
        </LinearGradient>
      </Defs>
      <Circle cx={16} cy={16} r={16} fill={`url(#${gradient})`} />
    </Svg>
  );
}

function SettingRow(props: {
  readonly title: string;
  readonly value: string;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.value ? `${props.title}, ${props.value}` : props.title}
      disabled={props.disabled}
      onPress={props.onPress}
      className="min-h-14 flex-row items-center gap-3 px-4 py-3 active:bg-subtle disabled:opacity-45"
    >
      <Text className="text-base text-foreground">{props.title}</Text>
      <Text className="min-w-0 flex-1 text-right text-base text-foreground-muted" numberOfLines={1}>
        {props.value}
      </Text>
      <UpIcon name="chevron-right" size={18} tintColorClassName="accent-chevron" />
    </Pressable>
  );
}

/** A setting whose value is picked from a native menu, as the desktop's selects. */
function MenuRow(props: {
  readonly title: string;
  readonly description?: string;
  readonly value: string;
  readonly icon?: UpIconName;
  readonly disabled?: boolean;
  readonly options: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly subtitle?: string;
    readonly image?: string;
  }>;
  readonly selected: string;
  readonly onSelect: (id: string) => void;
}) {
  const row = (
    <View
      className={cn(
        "min-h-14 flex-row items-center gap-3 px-4 py-3",
        props.disabled && "opacity-45",
      )}
    >
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="text-base text-foreground">{props.title}</Text>
        {props.description ? (
          <Text className="text-sm text-foreground-muted">{props.description}</Text>
        ) : null}
      </View>
      <View className="max-w-[55%] shrink flex-row items-center gap-1.5">
        {props.icon ? (
          <UpIcon name={props.icon} size={18} tintColorClassName="accent-icon-muted" />
        ) : null}
        <Text className="shrink text-base text-foreground-muted" numberOfLines={1}>
          {props.value}
        </Text>
        <UpIcon name="chevrons-up-down" size={16} tintColorClassName="accent-chevron" />
      </View>
    </View>
  );
  if (props.disabled) return row;
  return (
    <Menu
      title={props.title}
      actions={props.options.map((option) => ({
        id: option.id,
        title: option.title,
        ...(option.subtitle ? { subtitle: option.subtitle } : {}),
        ...(option.image ? { image: option.image } : {}),
        state: option.id === props.selected ? "on" : "off",
      }))}
      onPressAction={({ nativeEvent }) => props.onSelect(nativeEvent.event)}
      onOpenMenu={() => Keyboard.dismiss()}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${props.title}, ${props.value}`}
        className="active:bg-subtle"
      >
        {row}
      </Pressable>
    </Menu>
  );
}
