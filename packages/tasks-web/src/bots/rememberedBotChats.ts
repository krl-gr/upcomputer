import { useEffect } from "react";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

// Nothing here reaches web state, so the feature entry can hold these chats before the Bots
// section's code loads.
import { readLocalStorageValue } from "../../../../apps/web/src/hooks/useLocalStorage.ts";
import { claimSidebarThreads } from "../../../../apps/web/src/product/sidebarThreadClaims.ts";

/** Each computer's bot chat thread ids as its last loaded list had them. */
export const BOT_CHATS_STORAGE_KEY = "upcomputer:bot-chats";
export const BotChats = Schema.Record(Schema.String, Schema.Array(Schema.String));

export const readRememberedBotChats = () =>
  readLocalStorageValue(BOT_CHATS_STORAGE_KEY, {}, BotChats);

export const botChatKeys = (environmentId: EnvironmentId, threadIds: ReadonlyArray<string>) =>
  threadIds.map((threadId) =>
    scopedThreadKey(scopeThreadRef(environmentId, ThreadId.make(threadId))),
  );

/**
 * Holds every remembered bot chat out of Threads while the Bots section's code loads. On the
 * first start after an update that load is slow, and the chats showed under Threads meanwhile.
 */
export function RememberedBotChatsHold() {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- holds the claims registry entry while mounted
  useEffect(
    () =>
      claimSidebarThreads(
        "bots:loading",
        Object.entries(readRememberedBotChats()).flatMap(([environmentId, threadIds]) =>
          botChatKeys(EnvironmentId.make(environmentId), threadIds),
        ),
      ),
    [],
  );
  return null;
}
