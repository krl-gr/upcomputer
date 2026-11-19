import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";

/** Where a quote from a task's output goes. */
export type TaskQuoteTarget =
  | { readonly kind: "beside"; readonly threadRef: ScopedThreadRef }
  | { readonly kind: "root"; readonly threadRef: ScopedThreadRef; readonly title: string }
  | { readonly kind: "new-chat" };

/**
 * Beside a thread, its composer takes the quote. Elsewhere the chat the task's chain started from
 * does (not a worker's own run thread). With no such chat, a new chat in the task's project.
 */
export function taskQuoteTarget(input: {
  readonly besideThreadRef: ScopedThreadRef | undefined;
  readonly environmentId: EnvironmentId;
  readonly rootThreadId: ThreadId | null;
  /** The root chat as this client knows it; null when it is unknown or deleted. */
  readonly rootThread: { readonly title: string } | null;
}): TaskQuoteTarget {
  if (input.besideThreadRef) return { kind: "beside", threadRef: input.besideThreadRef };
  if (input.rootThreadId && input.rootThread) {
    return {
      kind: "root",
      threadRef: { environmentId: input.environmentId, threadId: input.rootThreadId },
      title: input.rootThread.title,
    };
  }
  return { kind: "new-chat" };
}

export function taskQuoteDestinationLabel(target: TaskQuoteTarget): string {
  switch (target.kind) {
    case "beside":
      return "Cite in chat";
    case "root":
      return `Cite in "${target.title}"`;
    case "new-chat":
      return "Cite in a new chat";
  }
}
