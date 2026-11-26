import type { StaticScreenProps } from "@react-navigation/native";
import { EnvironmentId } from "@t3tools/contracts";
import { TaskAgentId, type BotMemory } from "@t3tools/tasks-contracts/v1";
import { useGT } from "gt-react-native";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { RelativeTime } from "../../components/RelativeTime";
import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { AppText as Text } from "../../components/ui/AppText";
import { EmptyState } from "../../components/ui/EmptyState";
import { useWorkspaceState } from "../../state/workspace";
import { PullRequestSheetContent } from "../pull-requests/PullRequestSheetContent";
import { readTasksClient, useTasksAccess } from "../tasks/tasksRpc";
import { botLists } from "./botsData";
import { orderedBotMemory } from "./botState";

export type BotMemoryParams = {
  readonly environmentId: string;
  readonly agentId: string;
  readonly name: string;
};

type MemoryLoad =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly entries: ReadonlyArray<BotMemory> }
  | { readonly state: "error"; readonly error: string };

/** What a bot remembers, read-only: the desktop's bot page edits it. */
export function BotMemoryScreen({ route }: StaticScreenProps<BotMemoryParams>) {
  const gt = useGT();
  const environmentId = EnvironmentId.make(route.params.environmentId);
  const agentId = TaskAgentId.make(route.params.agentId);
  const { environments } = useWorkspaceState();
  const environment = environments.find((entry) => entry.environmentId === environmentId);
  const connected = environment?.connectionState === "connected";
  const access = useTasksAccess(connected ? environmentId : null);
  const readable = access?.canReadAgents === true;
  const [load, setLoad] = useState<MemoryLoad>({ state: "loading" });
  const bot = botLists.readShown(environmentId)?.find((entry) => entry.agent.id === agentId);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the bot's memory from its computer once access allows it
  useEffect(() => {
    if (!readable) return;
    let cancelled = false;
    readTasksClient(environmentId)
      .bots.memory({ agentId })
      .then(
        (memories): MemoryLoad => ({ state: "ready", entries: orderedBotMemory(memories) }),
        (cause: unknown): MemoryLoad => ({
          state: "error",
          error: cause instanceof Error ? cause.message : String(cause),
        }),
      )
      .then((next) => {
        if (!cancelled) setLoad(next);
      });
    return () => {
      cancelled = true;
    };
  }, [readable, environmentId, agentId]);

  return (
    <PullRequestSheetContent
      title={gt("{name}'s memory", { name: route.params.name })}
      subtitle={environment?.environmentLabel ?? ""}
    >
      {bot?.memoryMode === "agent" ? (
        <Text className="text-sm text-foreground-muted">
          {gt(
            "{name}'s agent keeps its own memory, so new facts aren't saved here. These entries stay for a switch back.",
            { name: route.params.name },
          )}
        </Text>
      ) : null}
      {!connected ? (
        <EmptyState
          title={gt("Computer offline")}
          detail={gt("Reconnect to see this bot's memory.")}
          variant="plain"
        />
      ) : load.state === "loading" ? (
        <AppActivityIndicator
          className="my-8"
          colorClassName="accent-icon"
          accessibilityLabel={gt("Loading memory")}
        />
      ) : load.state === "error" ? (
        <EmptyState title={gt("Couldn't load this memory")} detail={load.error} variant="plain" />
      ) : load.entries.length === 0 ? (
        // An agent that keeps its own memory saves nothing here; the note above says so.
        bot?.memoryMode === "agent" ? null : (
          <EmptyState
            title={gt("Nothing remembered yet")}
            detail={gt("{name} saves what it learns from your chats here.", {
              name: route.params.name,
            })}
            variant="plain"
          />
        )
      ) : (
        <View className="gap-2">
          {load.entries.map((entry) => (
            <View key={entry.id} className="gap-1 rounded-[20px] bg-grouped-card px-4 py-3">
              <Text selectable className="text-base leading-6 text-foreground">
                {entry.text}
              </Text>
              <Text className="text-xs text-foreground-muted">
                {entry.owner === "user"
                  ? gt("Saved by you", { $context: "who wrote a bot memory entry" })
                  : gt("Saved by {name}", { name: route.params.name })}
                {" · "}
                <RelativeTime timestamp={entry.updatedAt} />
              </Text>
            </View>
          ))}
        </View>
      )}
    </PullRequestSheetContent>
  );
}
