import type { EnvironmentId } from "@t3tools/contracts";

import { ContextChipShell } from "../components/contextChipParts";
import { productComposerRecipients } from "./composerRecipients";
import { findComposerRecipient } from "./composerRecipients.logic";

/**
 * A recipient's chip in place of the file chip the editor draws for an `@` mention, or null
 * when the mention names no recipient.
 */
export function composerRecipientChip(environmentId: EnvironmentId | null, name: string) {
  if (environmentId === null) return null;
  const recipient = findComposerRecipient(productComposerRecipients(environmentId, null), name);
  if (recipient === undefined) return null;
  const Icon = recipient.icon;
  return (
    <ContextChipShell
      kind="neutral"
      icon={Icon ? <Icon className="size-[1em] shrink-0" /> : null}
      label={recipient.name}
      tooltip={recipient.description}
      contentEditable={false}
      spellCheck={false}
    />
  );
}
