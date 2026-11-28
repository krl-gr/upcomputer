import { useNavigation } from "@react-navigation/native";
import { useGT } from "gt-react-native";
import type { ComponentProps } from "react";

import type { AppBarMenu, AppBarTitlePill } from "../../components/ui/AppBar.types";
import { useThreadBot } from "../bots/botsData";
import { BotCharacter } from "../bots/character/BotCharacter";
import { ThreadHeader } from "../threads/ThreadHeader";
import { openSidePanelSurface, updateSidePanel, useSidePanel } from "./sidePanelState";
import {
  useSidePanelEntries,
  type SidePanelEntriesInput,
  type SurfaceEntry,
} from "./useSidePanelEntries";

/**
 * A chat's bar: upstream's ThreadHeader with the bot's pill in place of the title, and with no
 * panel view open, the panel button as the views menu; picking one opens the panel on it.
 */
export function ChatThreadHeader(
  props: Omit<ComponentProps<typeof ThreadHeader>, "bot" | "panelMenu"> & {
    readonly sidePanel: SidePanelEntriesInput;
  },
) {
  const { sidePanel, ...headerProps } = props;
  const bot = useThreadBotPill(sidePanel.thread);
  const panelMenu = useSidePanelMenu(sidePanel, props.onOpenSidePanel);
  return <ThreadHeader {...headerProps} bot={bot} panelMenu={panelMenu} />;
}

function useThreadBotPill(thread: SidePanelEntriesInput["thread"]): AppBarTitlePill | undefined {
  const gt = useGT();
  const navigation = useNavigation();
  const bot = useThreadBot(thread.environmentId, thread.id);
  if (!bot) return undefined;
  return {
    icon: <BotCharacter id={bot.agent.id} appearance={bot.appearance} size={22} />,
    label: bot.agent.name,
    accessibilityLabel: gt("Settings for {name}", { name: bot.agent.name }),
    onPress: () =>
      navigation.navigate("BotSettings", {
        environmentId: String(thread.environmentId),
        agentId: String(bot.agent.id),
      }),
  };
}

function useSidePanelMenu(
  input: SidePanelEntriesInput,
  onOpenSidePanel: (() => void) | undefined,
): AppBarMenu | undefined {
  const gt = useGT();
  const threadKey = `${input.thread.environmentId}:${input.thread.id}`;
  const panel = useSidePanel(threadKey);
  const { entries, openPullRequest } = useSidePanelEntries(input);
  if (!onOpenSidePanel || panel.tabs.length > 0) return undefined;
  const open = (surface: SurfaceEntry["surface"]) => {
    if (surface === "pullRequest") return openPullRequest();
    updateSidePanel(threadKey, (state) => openSidePanelSurface(state, surface));
    onOpenSidePanel();
  };
  return {
    title: gt("Open view"),
    icon: "up.panel-bottom",
    items: entries.map((entry) => ({
      id: entry.surface,
      title: entry.label,
      icon: entry.symbol,
      ...(entry.available ? {} : { subtitle: entry.hint, disabled: true }),
      onPress: () => open(entry.surface),
    })),
  };
}
