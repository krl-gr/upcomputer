import { IsoDateTime, ProjectId, ThreadId, TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { TaskAgent, TaskAgentConfig, TaskAgentId } from "./agents.ts";
import { TaskError, TaskResponse } from "./tasks.ts";

const botColorIds = [
  "gray",
  "blue",
  "orange",
  "black",
  "green",
  "brown",
  "purple",
  "red",
  "teal",
  "yellow",
  "coral",
  "navy",
] as const;

// Keep this order stable: bots that never picked a portrait derive theirs from their id.
export const botPortraitIds = [
  "vermeer-girl",
  "leonardo",
  "mona-lisa",
  "venus",
  "rembrandt",
  "beethoven",
  "ada",
  "socrates",
  "frida",
  "van-gogh",
  "mozart",
  "newton",
  "shakespeare",
  "napoleon",
  "cleopatra",
  "athena",
  "the-scream",
  "american-gothic",
  "the-fifer",
  "son-of-man",
  "the-milkmaid",
  "lady-with-an-ermine",
  "girl-with-peaches",
  "the-blue-boy",
  "infanta",
  "the-swing",
  "the-astronomer",
  "the-sleeping-gypsy",
] as const;
export const BotPortraitId = Schema.Literals(botPortraitIds);
export type BotPortraitId = typeof BotPortraitId.Type;

/** The portrait of a bot that never picked one, an FNV-1a hash of its id. */
export const defaultBotPortrait = (id: string): BotPortraitId => {
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return botPortraitIds[hash % botPortraitIds.length]!;
};

export const BotAppearanceStyle = Schema.Literals(["portrait", "character"]);

export const BotAppearance = Schema.Struct({
  /** Which face the UI draws. Missing draws the portrait; both configs stay either way. */
  style: Schema.optional(BotAppearanceStyle),
  /** The picked portrait. Missing draws `defaultBotPortrait`. */
  portrait: Schema.optional(BotPortraitId),
  // The shape character, drawn when `style` is "character"; older clients always draw it.
  shape: Schema.Literals([
    "drop",
    "triangle",
    "cloud",
    "circle",
    "capsule",
    "peanut",
    "diamond",
    "bean",
    "dome",
    "squircle",
    "star",
    "blob",
  ]),
  color: Schema.Literals(botColorIds),
  accessory: Schema.Literals([
    "none",
    "bowtie",
    "gentleman",
    "detective",
    "chef",
    "builder",
    "artist",
    "graduate",
    "cowboy",
    "wizard",
    "professor",
    "headphones",
    "crown",
    "pirate",
    "firefighter",
    "police",
    "nurse",
    "scientist",
    "pilot",
    "santa",
    "winter",
    "summer",
    "photographer",
    "bunny",
  ]),
});
export type BotAppearance = typeof BotAppearance.Type;

/** The look of a bot that never chose one: a capsule in a color derived from its id. */
export const defaultBotAppearance = (id: string): BotAppearance => ({
  shape: "capsule",
  color:
    botColorIds[
      [...id].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 0) % botColorIds.length
    ]!,
  accessory: "none",
});

export const Bot = Schema.Struct({
  agent: TaskAgent,
  /** Missing or null draws `defaultBotAppearance` for older bots and servers. */
  appearance: Schema.optional(Schema.NullOr(BotAppearance)),
  threadId: ThreadId,
  projectId: ProjectId,
  allowedProjectIds: Schema.Array(ProjectId),
  latestTaskRun: Schema.optional(
    Schema.Struct({
      threadId: ThreadId,
      status: Schema.String,
      /** When the run ended; absent from older servers and while it runs. */
      completedAt: Schema.optional(Schema.NullOr(IsoDateTime)),
    }),
  ),
  /**
   * Threads of the active runs of tasks started from the bot's chat, by the bot itself or
   * by any agent; their approvals and questions show as the bot's. Absent from older servers.
   */
  activeTaskRunThreadIds: Schema.optional(Schema.Array(ThreadId)),
});
export type Bot = typeof Bot.Type;

export const BotWriteInput = Schema.Struct({
  id: TaskAgentId,
  threadId: Schema.optional(ThreadId),
  projectId: ProjectId,
  allowedProjectIds: Schema.Array(ProjectId),
  name: TrimmedNonEmptyString,
  config: TaskAgentConfig,
  /** Omitted preserves the saved style. Null clears it back to `defaultBotAppearance`. */
  appearance: Schema.optional(Schema.NullOr(BotAppearance)),
});
export type BotWriteInput = typeof BotWriteInput.Type;

export const BotMemory = Schema.Struct({
  id: TrimmedNonEmptyString,
  agentId: TaskAgentId,
  projectId: Schema.NullOr(ProjectId),
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(2000)),
  source: TrimmedNonEmptyString.check(Schema.isMaxLength(500)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  /**
   * Who wrote the current text. The bot cannot change or forget a user's entry. Missing
   * (older servers) means the bot's.
   */
  owner: Schema.optional(Schema.Literals(["user", "bot"])),
});
export type BotMemory = typeof BotMemory.Type;

/** The size limit of the memory a bot turn shows the model, in characters of its JSON. */
export const BOT_MEMORY_CONTEXT_BUDGET = 11998;

/** One memory as a bot turn shows it to the model. The budget counts this JSON. */
export const botMemoryForModel = (entry: BotMemory) => ({
  id: entry.id,
  scope: entry.projectId === null ? "global" : "project",
  owner: entry.owner ?? "bot",
  text: entry.text,
  updatedAt: entry.updatedAt,
});

// JSON never needs a raw "<", so escaping it keeps memory text from closing the block's tag.
export const botMemoryData = (value: unknown) => JSON.stringify(value).replaceAll("<", "\\u003c");

const memoryRank = (entry: BotMemory) =>
  entry.owner === "user" ? 0 : entry.projectId !== null ? 1 : 2;

/**
 * The memories a bot turn in `projectId` can see, in selection order (the user's entries,
 * then the project's, then global ones, each newest first), and the ones that fit the
 * budget. The server sends exactly `selected`, and the bot page marks entries from the same
 * function, so the two cannot disagree. A large entry that does not fit is skipped, not the
 * end of the selection.
 */
export function botMemoryContext(memories: ReadonlyArray<BotMemory>, projectId: string) {
  const entries = memories
    .filter((entry) => entry.projectId === null || entry.projectId === projectId)
    .sort(
      (a, b) =>
        memoryRank(a) - memoryRank(b) ||
        (a.updatedAt === b.updatedAt ? (a.id < b.id ? -1 : 1) : a.updatedAt < b.updatedAt ? 1 : -1),
    );
  const selected: Array<BotMemory> = [];
  // The opening bracket, then each entry with the comma or closing bracket after it.
  let size = 1;
  for (const entry of entries) {
    const added = botMemoryData(botMemoryForModel(entry)).length + 1;
    if (size + added > BOT_MEMORY_CONTEXT_BUDGET) continue;
    size += added;
    selected.push(entry);
  }
  return { entries, selected, used: selected.length === 0 ? 0 : size };
}
/** Suggested by a background task run; accepting writes `targetId` as an ordinary memory. */
export const BotMemoryProposal = Schema.Struct({
  ...BotMemory.fields,
  targetId: TrimmedNonEmptyString,
});
export type BotMemoryProposal = typeof BotMemoryProposal.Type;
export const BotMemoryWriteInput = Schema.Struct({
  agentId: TaskAgentId,
  id: TrimmedNonEmptyString,
  projectId: Schema.NullOr(ProjectId),
  text: BotMemory.fields.text,
  source: BotMemory.fields.source,
});
export type BotMemoryWriteInput = typeof BotMemoryWriteInput.Type;

export const BOTS_RPC_NAMESPACE = "upcomputer.bots.v1";
export const BOTS_RPC_METHODS = {
  list: `${BOTS_RPC_NAMESPACE}.list`,
  save: `${BOTS_RPC_NAMESPACE}.save`,
  remove: `${BOTS_RPC_NAMESPACE}.remove`,
  memory: `${BOTS_RPC_NAMESPACE}.memory`,
  remember: `${BOTS_RPC_NAMESPACE}.remember`,
  forget: `${BOTS_RPC_NAMESPACE}.forget`,
  proposals: `${BOTS_RPC_NAMESPACE}.proposals`,
  acceptProposal: `${BOTS_RPC_NAMESPACE}.acceptProposal`,
  rejectProposal: `${BOTS_RPC_NAMESPACE}.rejectProposal`,
  assign: `${BOTS_RPC_NAMESPACE}.assign`,
  extract: `${BOTS_RPC_NAMESPACE}.extract`,
} as const;
const agentInput = Schema.Struct({ agentId: TaskAgentId });
const entryInput = Schema.Struct({ ...agentInput.fields, id: TrimmedNonEmptyString });
export const BotsRpcGroup = RpcGroup.make(
  Rpc.make(BOTS_RPC_METHODS.extract, {
    payload: Schema.Struct({ ...agentInput.fields, requestId: TrimmedNonEmptyString }),
    error: TaskError,
  }),
  Rpc.make(BOTS_RPC_METHODS.list, {
    payload: Schema.Struct({}),
    success: Schema.Array(Bot),
    error: TaskError,
  }),
  Rpc.make(BOTS_RPC_METHODS.save, { payload: BotWriteInput, success: Bot, error: TaskError }),
  Rpc.make(BOTS_RPC_METHODS.remove, { payload: agentInput, error: TaskError }),
  Rpc.make(BOTS_RPC_METHODS.memory, {
    payload: agentInput,
    success: Schema.Array(BotMemory),
    error: TaskError,
  }),
  Rpc.make(BOTS_RPC_METHODS.remember, {
    payload: BotMemoryWriteInput,
    success: BotMemory,
    error: TaskError,
  }),
  Rpc.make(BOTS_RPC_METHODS.forget, { payload: entryInput, error: TaskError }),
  Rpc.make(BOTS_RPC_METHODS.proposals, {
    payload: agentInput,
    success: Schema.Array(BotMemoryProposal),
    error: TaskError,
  }),
  Rpc.make(BOTS_RPC_METHODS.acceptProposal, {
    payload: entryInput,
    success: BotMemory,
    error: TaskError,
  }),
  Rpc.make(BOTS_RPC_METHODS.rejectProposal, { payload: entryInput, error: TaskError }),
  Rpc.make(BOTS_RPC_METHODS.assign, {
    payload: Schema.Struct({
      ...agentInput.fields,
      requestId: TrimmedNonEmptyString,
      title: TrimmedNonEmptyString,
      description: Schema.String,
    }),
    success: TaskResponse,
    error: TaskError,
  }),
);
