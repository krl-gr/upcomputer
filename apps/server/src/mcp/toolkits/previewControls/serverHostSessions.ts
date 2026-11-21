import type {
  PreviewAutomationStatus,
  PreviewListResult,
  PreviewSessionSnapshot,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import type { McpThreadInvocationScope } from "../../McpInvocationContext.ts";
import * as PreviewAutomationBroker from "../../PreviewAutomationBroker.ts";

/** Adds the tabs of server-side hosts, such as the managed Chrome, after the server's own tabs. */
export const withServerHostSessions = Effect.fn("PreviewControls.withServerHostSessions")(
  function* (scope: McpThreadInvocationScope, result: PreviewListResult) {
    const broker = yield* PreviewAutomationBroker.PreviewAutomationBroker;
    const updatedAt = DateTime.formatIso(yield* DateTime.now);
    const hostSessions = yield* Effect.forEach(yield* broker.serverHostTabs(scope), (tabId) =>
      broker
        .invoke<PreviewAutomationStatus>({
          scope,
          operation: "status",
          input: {},
          tabId,
          timeoutMs: 2_000,
          updateCurrentTab: false,
        })
        .pipe(
          Effect.orElseSucceed(() => null),
          Effect.map((status): PreviewSessionSnapshot => ({
            threadId: scope.thread.threadId,
            tabId,
            navStatus: status?.url
              ? { _tag: "Success", url: status.url, title: status.title ?? "" }
              : { _tag: "Idle" },
            canGoBack: false,
            canGoForward: false,
            runtime: "server",
            updatedAt,
          })),
        ),
    );
    return { ...result, sessions: [...result.sessions, ...hostSessions] };
  },
);
