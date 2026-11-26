import { NodeViewWrapper } from "@tiptap/react";
import { use } from "react";

import { ComposerContextActionsContext } from "../components/composerContextActions";
import { ContextChipShell } from "../components/contextChipParts";
import { useProductComposerRecipients } from "./composerRecipients";
import { findComposerRecipientChip } from "@t3tools/tasks-client/composerRecipients";

/**
 * Reactive recipient chip node for the Tiptap mention view: subscribes to the active thread's
 * addressable recipients so restored drafts update once bots load and a bot's own chat leaves
 * its name as a normal token.
 */
export function useComposerRecipientChipNode(path: string, className: string) {
  const actions = use(ComposerContextActionsContext);
  const recipients = useProductComposerRecipients(actions.environmentId, actions.threadId ?? null);
  const recipient = findComposerRecipientChip(recipients, path);
  if (recipient === undefined) return null;
  const Icon = recipient.icon;
  return (
    <NodeViewWrapper as="span" className={className}>
      <ContextChipShell
        kind="neutral"
        icon={Icon ? <Icon className="size-[1em] shrink-0" /> : null}
        label={recipient.name}
        tooltip={recipient.description}
        contentEditable={false}
        spellCheck={false}
      />
    </NodeViewWrapper>
  );
}
