import type { BotStatusDetail, BotStatusKind } from "@t3tools/tasks-client/bots/botStatus";
import { defaultBotAppearance, type Bot, type BotAppearance } from "@t3tools/tasks-contracts/v1";
import { msg } from "gt-react-native";

import type { UpIconName } from "../../components/up-icons/UpIcon";
import type { BotCharacterState } from "./character/catalog";

export interface BotStatusTone {
  /** English, from `msg()`; the desktop's thread status words. */
  readonly label: string;
  readonly icon: UpIconName;
  readonly tint: string;
  readonly text: string;
}

export const BOT_STATUS_TONES: { readonly [Kind in BotStatusKind]: BotStatusTone } = {
  preparing: {
    label: msg("Setting up", { $context: "bot status" }),
    icon: "circle-dashed",
    tint: "accent-adaptive-sky-600-400",
    text: "text-adaptive-sky-600-400",
  },
  working: {
    label: msg("Working", { $context: "bot status" }),
    icon: "circle-dashed",
    tint: "accent-adaptive-sky-600-400",
    text: "text-adaptive-sky-600-400",
  },
  waiting: {
    label: msg("Waiting", { $context: "bot status" }),
    icon: "circle-dashed",
    tint: "accent-foreground-muted",
    text: "text-foreground-muted",
  },
  approval: {
    label: msg("Pending approval", { $context: "bot status" }),
    icon: "shield-alert",
    tint: "accent-warning-foreground",
    text: "text-warning-foreground",
  },
  input: {
    label: msg("Awaiting input", { $context: "bot status" }),
    icon: "message-question",
    tint: "accent-adaptive-indigo-600-300",
    text: "text-adaptive-indigo-600-300",
  },
  request: {
    label: msg("Guest request", { $context: "bot status" }),
    icon: "user-circle",
    tint: "accent-adaptive-fuchsia-600-300",
    text: "text-adaptive-fuchsia-600-300",
  },
  done: {
    label: msg("Completed", { $context: "bot status" }),
    icon: "circle-check",
    tint: "accent-adaptive-emerald-700-300",
    text: "text-adaptive-emerald-700-300",
  },
  failed: {
    label: msg("Failed", { $context: "bot status" }),
    icon: "alert-circle",
    tint: "accent-danger-foreground",
    text: "text-danger-foreground",
  },
  limited: {
    label: msg("Limited", { $context: "bot status, usage limit reached" }),
    icon: "alert-circle",
    tint: "accent-warning-foreground",
    text: "text-warning-foreground",
  },
};

/** The character's state for each status, as the desktop's Bots section picks it. */
export const BOT_CHARACTER_STATES: { readonly [Kind in BotStatusKind]: BotCharacterState } = {
  preparing: "working",
  working: "working",
  waiting: "waiting",
  approval: "attention",
  input: "attention",
  request: "attention",
  done: "done",
  failed: "failed",
  limited: "limited",
};

export const BOT_STATUS_DETAILS: { readonly [Detail in BotStatusDetail]: string } = {
  planReview: msg("Plan ready for review"),
  taskApproval: msg("Background task needs approval"),
  taskQuestion: msg("Background task asks a question"),
  taskWaiting: msg("Waiting for its background task"),
  taskBlocked: msg("Background task is blocked"),
  taskInterrupted: msg("Background task was interrupted"),
  taskFailed: msg("Background task failed"),
  taskLimited: msg("Background task hit a provider limit"),
  chatTaskApproval: msg("A task from this chat needs approval"),
  chatTaskQuestion: msg("A task from this chat asks a question"),
};

// The desktop draws a character in these colors; the phone shows the bot's initial on it.
const BOT_COLORS: { readonly [Color in BotAppearance["color"]]: string } = {
  gray: "#8e8e93",
  blue: "#3b82f6",
  orange: "#f97316",
  black: "#3a3a3c",
  green: "#22a55a",
  brown: "#a16207",
  purple: "#8b5cf6",
  red: "#ef4444",
  teal: "#14b8a6",
  yellow: "#eab308",
  coral: "#fb7185",
  navy: "#1e3a8a",
};

export const botColor = (bot: Bot) =>
  BOT_COLORS[(bot.appearance ?? defaultBotAppearance(bot.agent.id)).color];

export const botInitial = (bot: Bot) => [...bot.agent.name.trim()][0]?.toLocaleUpperCase() ?? "?";
