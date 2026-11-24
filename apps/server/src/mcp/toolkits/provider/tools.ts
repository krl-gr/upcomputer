import { OrchestratorMcpFailure } from "@t3tools/contracts";
import { PROVIDER_SIGN_IN_TOOL_NAME } from "@t3tools/shared/providerSignIn";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ProviderSignIn from "../../../provider/ProviderSignIn.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

// Small models (OpenCode's free ones) pick tools by name and first sentence, so both say only the purpose.
const ProviderSignInTool = Tool.make(PROVIDER_SIGN_IN_TOOL_NAME, {
  description:
    "Sign the user in to a coding agent such as Claude Code, Codex, Grok or Antigravity. Shows the sign-in in this chat: a terminal with the sign-in command typed in, or the app's own sign-in. Call again after the user finishes: it reports whether the agent is signed in.",
  parameters: Schema.Struct({
    provider: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)).annotate({
      description: "The agent's provider id or name, such as claudeAgent, codex or grok.",
    }),
  }),
  success: ProviderSignIn.ProviderSignInResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ProviderSignIn.ProviderSignIn,
  ],
})
  .annotate(Tool.Title, "Sign in to a coding agent")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

export const ProviderToolkit = Toolkit.make(ProviderSignInTool);
