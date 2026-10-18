import type { OrchestrationV2ThreadShell } from "@t3tools/contracts";

export type BotCharacterState = "idle" | "working" | "waiting" | "limited" | "attention";
export function botStatus(
  thread: Pick<
    OrchestrationV2ThreadShell,
    "status" | "lastErrorClass" | "pendingRuntimeRequest" | "hasActionableProposedPlan"
  > | null,
): { state: BotCharacterState; label: string } {
  if (!thread) return { state: "idle", label: "Offline" };
  if (thread.pendingRuntimeRequest !== null || thread.hasActionableProposedPlan)
    return { state: "attention", label: "Needs your attention" };
  if (thread.lastErrorClass === "usage_limit" && thread.status === "failed")
    return { state: "limited", label: "Provider limit" };
  if (thread.status === "queued" || thread.status === "waiting")
    return { state: "waiting", label: "Waiting" };
  if (["preparing", "starting", "running"].includes(thread.status))
    return { state: "working", label: "Working" };
  if (thread.status === "failed") return { state: "attention", label: "Review error" };
  return { state: "idle", label: "Idle" };
}
