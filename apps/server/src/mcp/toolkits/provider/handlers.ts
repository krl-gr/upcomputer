import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as ProviderSignIn from "../../../provider/ProviderSignIn.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { ProviderToolkit } from "./tools.ts";

const FAILURE_CODES = {
  unknown_provider: "invalid_request",
  disabled: "provider_unavailable",
  not_installed: "provider_unavailable",
  no_window: "capability_denied",
  terminal_failed: "orchestration_error",
} as const;

export const layer = McpToolAccess.toLayer(ProviderToolkit, {
  provider_sign_in: McpToolAccess.actsAsCaller(({ provider }) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const { thread } = yield* McpInvocationContext.requireThreadScope(scope, "provider_sign_in");
      const signIn = yield* ProviderSignIn.ProviderSignIn;
      return yield* signIn.signIn({ threadId: thread.threadId, provider }).pipe(
        Effect.mapError(
          (error) =>
            new OrchestratorMcpFailure({
              code: FAILURE_CODES[error.reason],
              message: error.message,
            }),
        ),
      );
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof ProviderToolkit.tools>);
