import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId } from "@t3tools/contracts";
import type { Bot } from "@t3tools/tasks-contracts/v1";
import { useNavigate } from "@tanstack/react-router";
import { useGT } from "gt-react";
import { ChevronDownIcon, MessageSquarePlusIcon } from "lucide-react";
import type { ReactElement } from "react";

import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../../../../apps/web/src/components/ui/menu.tsx";
import {
  type ComposerThreadTarget,
  useComposerDraftStore,
} from "../../../../apps/web/src/composerDraftStore.ts";
import { useHandleNewThread } from "../../../../apps/web/src/hooks/useHandleNewThread.ts";
import { randomUUID } from "../../../../apps/web/src/lib/utils.ts";
import {
  useConnectedEnvironmentIds,
  usePrimaryEnvironmentId,
} from "../../../../apps/web/src/state/environments.ts";
import { BotAvatar, useBotSectionLists } from "../bots/botData.tsx";
import {
  type InstructionUpdateEntry,
  instructionUpdatesBrief,
  instructionUpdatesBriefName,
} from "./workflowUpdates.ts";

/** Puts the brief in a chat's composer: a short ask, and the full brief as an attached file. */
function placeBrief(target: ComposerThreadTarget, entries: ReadonlyArray<InstructionUpdateEntry>) {
  const store = useComposerDraftStore.getState();
  const file = new File([instructionUpdatesBrief(entries)], instructionUpdatesBriefName(entries), {
    type: "text/markdown",
  });
  store.addFiles(
    target,
    [
      {
        type: "file",
        id: randomUUID(),
        name: file.name,
        mimeType: "text/markdown",
        sizeBytes: file.size,
        file,
      },
    ],
    { appendReference: true },
  );
  const ask =
    entries.length === 1
      ? "Help me decide how to apply this update. Look at how I work first, and change nothing until I agree."
      : "Help me decide how to apply these updates. Look at how I work first, and change nothing until I agree.";
  const prompt = useComposerDraftStore.getState().getComposerDraft(target)?.prompt ?? "";
  if (!prompt.includes(ask)) {
    store.setPrompt(target, `${prompt}${prompt && !/\s$/.test(prompt) ? " " : ""}${ask}`);
  }
}

/**
 * Opens a chat about the given updates with the brief ready in its composer. With one
 * bot it names the bot, with several it offers them, and without bots it opens a new chat.
 */
export function DiscussUpdatesButton({
  entries,
  render,
  onOpened,
}: {
  readonly entries: ReadonlyArray<InstructionUpdateEntry>;
  /** The button to draw: it gets the label and, with several bots, the chevron. */
  readonly render: ReactElement<Record<string, unknown>>;
  readonly onOpened?: () => void;
}) {
  const gt = useGT();
  const navigate = useNavigate();
  const primary = usePrimaryEnvironmentId();
  const connected = useConnectedEnvironmentIds();
  const lists = useBotSectionLists([...new Set([...(primary ? [primary] : []), ...connected])]);
  const bots = lists.flatMap(({ environmentId, bots: found }) =>
    found.map((bot) => ({ environmentId, bot })),
  );
  const { defaultProjectRef, handleNewThread } = useHandleNewThread();

  const openBot = (environmentId: EnvironmentId, bot: Bot) => {
    placeBrief(scopeThreadRef(environmentId, bot.threadId), entries);
    onOpened?.();
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId, threadId: bot.threadId },
    });
  };
  const openNewChat = () => {
    onOpened?.();
    if (!defaultProjectRef) return;
    void handleNewThread(defaultProjectRef).then(
      (draft) => draft && placeBrief(draft.draftId, entries),
    );
  };

  const Button = render.type as React.ElementType;
  const only = bots.length === 1 ? bots[0] : undefined;
  if (bots.length === 0) {
    return (
      <Button {...render.props} data-track="instruction-updates.discuss" onClick={openNewChat}>
        {gt("Discuss in a chat")}
      </Button>
    );
  }
  if (only) {
    return (
      <Button
        {...render.props}
        data-track="instruction-updates.discuss"
        onClick={() => openBot(only.environmentId, only.bot)}
      >
        {gt("Discuss with {bot}", { bot: only.bot.agent.name })}
      </Button>
    );
  }
  return (
    <Menu>
      <MenuTrigger render={<Button {...render.props} data-track="instruction-updates.discuss" />}>
        {gt("Discuss with a bot")}
        <ChevronDownIcon aria-hidden className="size-3.5 opacity-70" />
      </MenuTrigger>
      <MenuPopup align="start">
        {bots.map(({ environmentId, bot }) => (
          <MenuItem key={bot.agent.id} onClick={() => openBot(environmentId, bot)}>
            <BotAvatar id={bot.agent.id} appearance={bot.appearance} state="idle" size={18} />
            {bot.agent.name}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem onClick={openNewChat}>
          <MessageSquarePlusIcon />
          {gt("New chat")}
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}
