import { OPENCODE_SUBAGENT_PROMPT, type OrchestratorFixtureInput } from "../shared.ts";

export function openCodeChildApprovalInput(): OrchestratorFixtureInput {
  return {
    // Full access answers OpenCode's asks itself, so only an approval mode shows one.
    runtimeMode: "approval-required",
    steps: [
      { type: "message", text: OPENCODE_SUBAGENT_PROMPT },
      { type: "approve_next_runtime_request" },
    ],
  };
}
