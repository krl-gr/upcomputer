import * as Effect from "effect/Effect";

import type {
  ExperimentalMcpTool,
  ExperimentalMcpToolResult,
  ExperimentalMcpToolSession,
} from "../../../../apps/server/src/extensionApi.ts";
import type { ComputerUseServiceShape } from "../computerUse/ComputerUseService.ts";
import {
  COMPUTER_USE_TOOLS,
  type ComputerUseToolDefinition,
} from "../computerUse/ComputerUseToolDefinitions.ts";

function denied(reason: string): ExperimentalMcpToolResult {
  return { isError: true, content: [{ type: "text", text: reason }] };
}

/**
 * What the session itself rules out before the shared policy runs. These
 * agents cannot yet ask the user for approval, so every case where the
 * bundled agent would ask is refused instead.
 */
export function computerUseSessionDenial(
  tool: Pick<ComputerUseToolDefinition, "mode">,
  session: ExperimentalMcpToolSession,
): string | undefined {
  if (session.interactionMode === undefined) {
    return "Computer use is unavailable: this thread's interaction mode could not be resolved.";
  }
  if (session.runtimeMode === "approval-required") {
    return "Computer use needs approval for every call in Supervised threads, and this agent cannot ask for it. Switch the thread to another access mode to use it.";
  }
  if (tool.mode === "action" && session.mutationPolicy !== "allow") {
    return `Computer control actions are unavailable in ${session.interactionMode.displayName} mode.`;
  }
  return undefined;
}

const APPROVAL_REQUIRED_REASON =
  "Computer Use asks for approval before control actions (Settings → Computer Use → Action approvals), and this agent cannot ask for it. Turn Action approvals off to let agents act.";

/**
 * The computer-use tools on the core MCP server, available to every harness.
 * Calls go through the same service and policy as the bundled agent's tools,
 * using the calling thread's current interaction mode.
 */
export function makeComputerUseMcpTools(
  computerUse: ComputerUseServiceShape,
): ReadonlyArray<ExperimentalMcpTool> {
  return COMPUTER_USE_TOOLS.map((tool) => ({
    name: tool.name,
    title: tool.label,
    description: tool.description,
    inputSchema: tool.inputSchema,
    readOnly: tool.mode === "observe",
    execute: (args, session) => {
      const denial = computerUseSessionDenial(tool, session);
      if (denial !== undefined || session.interactionMode === undefined) {
        return Effect.succeed(denied(denial ?? "Computer use is unavailable."));
      }
      const interactionMode = session.interactionMode;
      return Effect.tryPromise(async () => {
        const approval = await computerUse.shouldRequireApproval({
          toolName: tool.name,
          args,
          interactionMode,
        });
        if (approval.required) return denied(APPROVAL_REQUIRED_REASON);
        const result = await computerUse.callTool({ toolName: tool.name, args, interactionMode });
        return { isError: result.isError, content: result.content };
      }).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Computer-use MCP call failed", { toolName: tool.name, cause }).pipe(
            Effect.as(denied(`${tool.name} failed.`)),
          ),
        ),
      );
    },
  }));
}
