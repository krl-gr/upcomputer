import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  instructionUpdatesBrief,
  instructionUpdatesBriefName,
  type Bot,
  type InstructionUpdateEntry,
} from "@t3tools/tasks-contracts/v1";
import { useNavigate } from "@tanstack/react-router";
import { useGT } from "gt-react";
import { ChevronDownIcon, MessageSquarePlusIcon } from "lucide-react";
import type { ElementType, ReactElement } from "react";

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
import { useProjects } from "../../../../apps/web/src/state/entities.ts";
import { BotAvatar, useBotSectionLists } from "../bots/botData.tsx";

/** Puts the brief in a chat's composer: a short ask, and the full brief as an attached file. */
function placeBrief(
  target: ComposerThreadTarget,
  entries: ReadonlyArray<InstructionUpdateEntry>,
  ask: string,
) {
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
  const prompt = useComposerDraftStore.getState().getComposerDraft(target)?.prompt ?? "";
  if (!prompt.includes(ask)) {
    store.setPrompt(target, `${prompt}${prompt && !/\s$/.test(prompt) ? " " : ""}${ask}`);
  }
}

/**
 * Opens a chat about the given updates with the brief ready in its composer, never
 * sent. Only bots and projects of the updates' own environment are offered: the
 * chat's tools change the install they run on. One bot is named, several are
 * offered in a menu, and without bots a new chat opens.
 */
export function DiscussUpdatesButton({
  environmentId,
  entries,
  render,
  onOpened,
}: {
  readonly environmentId: EnvironmentId;
  readonly entries: ReadonlyArray<InstructionUpdateEntry>;
  /** The button to draw: it gets the label and, with several bots, the chevron. */
  readonly render: ReactElement<Record<string, unknown>>;
  readonly onOpened?: () => void;
}) {
  const gt = useGT();
  const navigate = useNavigate();
  const [list] = useBotSectionLists([environmentId]);
  const bots = list?.bots ?? [];
  const projects = useProjects();
  const { defaultProjectRef, handleNewThread } = useHandleNewThread();
  const ask =
    entries.length === 1
      ? gt(
          "Help me decide how to apply this update. Look at how I work first, and change nothing until I agree.",
        )
      : gt(
          "Help me decide how to apply these updates. Look at how I work first, and change nothing until I agree.",
        );

  const openBot = (bot: Bot) => {
    placeBrief(scopeThreadRef(environmentId, bot.threadId), entries, ask);
    onOpened?.();
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId, threadId: bot.threadId },
    });
  };
  const project =
    defaultProjectRef?.environmentId === environmentId
      ? defaultProjectRef
      : (() => {
          const found = projects.find(
            (candidate) =>
              candidate.environmentId === environmentId && candidate.archivedAt == null,
          );
          return found ? scopeProjectRef(found.environmentId, found.id) : null;
        })();
  const openNewChat = () => {
    onOpened?.();
    if (project === null) return;
    void handleNewThread(project, { prompt: ask }).then(
      (draft) => draft && placeBrief(draft.draftId, entries, ask),
    );
  };

  const ButtonElement = render.type as ElementType;
  const only = bots.length === 1 ? bots[0] : undefined;
  if (bots.length === 0) {
    return (
      <ButtonElement
        {...render.props}
        disabled={project === null}
        data-track="instruction-updates.discuss"
        onClick={openNewChat}
      >
        {gt("Discuss in a chat")}
      </ButtonElement>
    );
  }
  if (only) {
    return (
      <ButtonElement
        {...render.props}
        data-track="instruction-updates.discuss"
        onClick={() => openBot(only)}
      >
        {gt("Discuss with {bot}", { bot: only.agent.name })}
      </ButtonElement>
    );
  }
  return (
    <Menu>
      <MenuTrigger
        render={<ButtonElement {...render.props} data-track="instruction-updates.discuss" />}
      >
        {gt("Discuss with a bot")}
        <ChevronDownIcon aria-hidden className="size-3.5 opacity-70" />
      </MenuTrigger>
      <MenuPopup align="start">
        {bots.map((bot) => (
          <MenuItem key={bot.agent.id} onClick={() => openBot(bot)}>
            <BotAvatar id={bot.agent.id} appearance={bot.appearance} state="idle" size={18} />
            {bot.agent.name}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem disabled={project === null} onClick={openNewChat}>
          <MessageSquarePlusIcon />
          {gt("New chat")}
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}
