import type { PreviewAutomationStatus, PreviewSessionSnapshot } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Preview from "../../../preview/Manager.ts";
import {
  type McpThreadInvocationScope,
  requireThreadMcpCapability,
} from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { unavailable } from "../../threadAccess.ts";
import { PreviewControlsToolkit } from "./tools.ts";
import * as PreviewAutomationBroker from "../../PreviewAutomationBroker.ts";

const access = Effect.gen(function* () {
  const scope = yield* requireThreadMcpCapability("preview");
  return { scope, manager: yield* Preview.PreviewManager };
});
/** Tabs of server-side hosts, such as the managed Chrome, listed like the server's own tabs. */
const serverHostSessions = Effect.fn("PreviewControls.serverHostSessions")(function* (
  scope: McpThreadInvocationScope,
) {
  const broker = yield* PreviewAutomationBroker.PreviewAutomationBroker;
  const updatedAt = DateTime.formatIso(yield* DateTime.now);
  return yield* Effect.forEach(yield* broker.serverHostTabs(scope), (tabId) =>
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
});

export const layer = McpToolAccess.toLayer(PreviewControlsToolkit, {
  t3_preview_list: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const { scope, manager } = yield* access;
      const result = yield* manager.list({ threadId: scope.thread.threadId });
      const sessions = [...result.sessions, ...(yield* serverHostSessions(scope))];
      const start = input.cursor ?? 0;
      const end = start + (input.limit ?? 20);
      return {
        ...result,
        sessions: sessions.slice(start, end),
        nextCursor: end < sessions.length ? end : null,
      };
    }),
  ),
  t3_preview_close: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const { scope, manager } = yield* access;
      const { sessions } = yield* manager.list({ threadId: scope.thread.threadId });
      const session = sessions.find((candidate) => candidate.tabId === input.tabId);
      // Tabs of a server-side host, such as the managed Chrome, have no preview session.
      if (session === undefined || session.runtime === "server") {
        const broker = yield* PreviewAutomationBroker.PreviewAutomationBroker;
        // A tab no host has is already closed, as PreviewManager.close treats it.
        yield* broker.invoke({ scope, operation: "close", input: {}, tabId: input.tabId }).pipe(
          Effect.catchTags({
            PreviewAutomationTabNotFoundError: () => Effect.void,
            PreviewAutomationNoAvailableHostError: () => Effect.void,
          }),
        );
        return {};
      }
      yield* manager
        .close({ threadId: scope.thread.threadId, tabId: input.tabId })
        .pipe(Effect.mapError(unavailable));
      return {};
    }),
  ),
});
