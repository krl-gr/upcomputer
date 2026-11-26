import type { ModelSelection, ProjectId, RuntimeMode, ThreadId } from "@t3tools/contracts";
import {
  BotAppearance,
  type Bot,
  type BotMemoryMode,
  type BotWriteInput,
  type TaskAgentId,
} from "@t3tools/tasks-contracts/v1";

/** What a new bot is told to do until the user writes its instructions. */
export const DEFAULT_BOT_INSTRUCTIONS =
  "Help the user, remember useful facts, and keep them informed about your work.";

/** The bot settings page's fields, as the desktop and the phone edit them. */
export interface BotForm {
  readonly id: TaskAgentId;
  /** The chat a new bot adopts; absent for a bot that gets a new chat. */
  readonly threadId?: ThreadId;
  readonly name: string;
  readonly appearance: BotAppearance;
  readonly instructions: string;
  readonly projectId: ProjectId | null;
  readonly selection: ModelSelection | undefined;
  readonly runtimeMode: RuntimeMode;
  readonly memoryMode: BotMemoryMode;
}

/** The save request for a form, or null while a required field is empty. */
export function botWriteInput(
  form: BotForm,
  saved?: Pick<Bot["agent"], "config">,
): BotWriteInput | null {
  if (
    form.name.trim() === "" ||
    form.instructions.trim() === "" ||
    form.selection === undefined ||
    form.projectId === null
  )
    return null;
  return {
    id: form.id,
    ...(form.threadId ? { threadId: form.threadId } : {}),
    projectId: form.projectId,
    // The bot lives in one project; its memory is global or that project's.
    allowedProjectIds: [form.projectId],
    name: form.name,
    appearance: form.appearance,
    memoryMode: form.memoryMode,
    config: {
      ...saved?.config,
      // Task agents require a role; bots describe themselves through instructions.
      role: saved?.config.role ?? "Personal assistant",
      instructions: form.instructions,
      modelSelection: form.selection,
      runtimeMode: form.runtimeMode,
    },
  };
}

const pick = <T>(values: ReadonlyArray<T>, random: () => number): T =>
  values[Math.min(values.length - 1, Math.floor(random() * values.length))]!;

/** Randomize appearance: any shape, color and accessory. */
export function randomBotAppearance(random: () => number = Math.random): BotAppearance {
  const { shape, color, accessory } = BotAppearance.fields;
  return {
    shape: pick(shape.literals, random),
    color: pick(color.literals, random),
    accessory: pick(accessory.literals, random),
  };
}
