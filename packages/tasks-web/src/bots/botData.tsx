import { useEffect, useState, useSyncExternalStore } from "react";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  defaultBotAppearance,
  type Bot,
  type BotAppearance,
  type TaskAgentId,
} from "@t3tools/tasks-contracts/v1";
import { useThreadShell } from "../../../../apps/web/src/state/entities.ts";
import { resolveThreadLastVisitedAt } from "../../../../apps/web/src/components/Sidebar.logic.ts";
import { useUiStateStore } from "../../../../apps/web/src/uiStateStore.ts";
import { ConfigurableBotCharacter } from "../../../../apps/web/src/components/bot-character-configurable/ConfigurableBotCharacter.tsx";
import { readTasksWebClient, useTasksWebAccess } from "../environmentApi.ts";
import { botChatStatus, botStatus, botTaskStatus, type BotCharacterState } from "./botStatus.ts";

let revision = 0;
const listeners = new Set<() => void>();
/** Refetches every bot list after a write from this client. */
export function botsChanged() {
  revision += 1;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// The last list per environment, so a newly mounted chat header knows at once
// whether its thread is a bot chat instead of showing the header until it loads.
const lastLists = new Map<EnvironmentId, ReadonlyArray<Bot>>();

export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Bot operation failed.";

export function useBots(environmentId: EnvironmentId) {
  const version = useSyncExternalStore(
    subscribe,
    () => revision,
    () => revision,
  );
  const access = useTasksWebAccess(environmentId);
  const enabled = access.canReadAgents;
  const [bots, setBots] = useState<ReadonlyArray<Bot>>(() => lastLists.get(environmentId) ?? []);
  const [loaded, setLoaded] = useState(() => lastLists.has(environmentId));
  const [error, setError] = useState("");
  useEffect(() => {
    if (!enabled) return;
    return readTasksWebClient(environmentId).tasks.subscribe(
      () => botsChanged(),
      (cause) => setError(errorText(cause)),
    );
  }, [environmentId, enabled]);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    readTasksWebClient(environmentId)
      .bots.list({})
      .then(
        (value) => {
          if (disposed) return;
          lastLists.set(environmentId, value);
          setBots(value);
          setLoaded(true);
          setError("");
        },
        (cause: unknown) => {
          if (!disposed) setError(errorText(cause));
        },
      );
    return () => {
      disposed = true;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- External revisions invalidate persisted data without changing the environment.
  }, [environmentId, version, enabled]);
  return { bots, loaded, error, enabled };
}

/** Navigation to a bot's page: an existing bot, a chat to turn into one, or a new bot. */
export function botPage(
  environmentId: EnvironmentId,
  target: { readonly bot: TaskAgentId } | { readonly thread: ThreadId } | null = null,
) {
  return { to: "/bots", search: { environment: environmentId, ...target } } as never;
}

/** The saved appearance, or the default look for bots that never chose one. */
export function BotAvatar({
  id,
  appearance,
  state,
  size,
}: {
  readonly id: string;
  readonly appearance: BotAppearance | null | undefined;
  readonly state: BotCharacterState;
  readonly size: number;
}) {
  return (
    <ConfigurableBotCharacter
      appearance={appearance ?? defaultBotAppearance(id)}
      state={state}
      size={size}
      decorative
    />
  );
}

export function useBotStatus(environmentId: EnvironmentId, bot: Bot | undefined) {
  const chatRef = bot ? scopeThreadRef(environmentId, bot.threadId) : null;
  const thread = useThreadShell(chatRef);
  const localLastVisitedAt = useUiStateStore((state) =>
    chatRef ? state.threadLastVisitedAtById[scopedThreadKey(chatRef)] : undefined,
  );
  const background = useThreadShell(
    bot?.latestTaskRun ? scopeThreadRef(environmentId, bot.latestTaskRun.threadId) : null,
  );
  return botStatus(
    botChatStatus(
      thread
        ? {
            ...thread,
            lastVisitedAt: resolveThreadLastVisitedAt(thread.lastVisitedAt, localLastVisitedAt),
          }
        : null,
    ),
    botTaskStatus(bot?.latestTaskRun?.status, background),
  );
}
