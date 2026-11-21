import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  PreviewTabId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../../../config.ts";
import * as Preview from "../../../preview/Manager.ts";
import * as ServerSettings from "../../../serverSettings.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import * as McpToolAccessTestkit from "../../McpToolAccess.testkit.ts";
import * as PreviewAutomationBroker from "../../PreviewAutomationBroker.ts";
import * as PreviewControlsHandlers from "./handlers.ts";
import { PreviewControlsToolkit } from "./tools.ts";

it.effect(
  "list and close reach tabs without a preview session in their server-side host, and a gone tab counts as closed",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const threadId = ThreadId.make("preview-controls-thread");
        const environmentId = EnvironmentId.make("preview-controls-environment");
        const scope: McpInvocationContext.McpInvocationScope = {
          environmentId,
          requestNamespace: "preview-controls-provider-session",
          thread: {
            threadId,
            providerSessionId: "preview-controls-provider-session",
            providerInstanceId: ProviderInstanceId.make("codex"),
          },
          client: undefined,
          capabilities: new Set(["preview"]),
          issuedAt: 0,
        };
        const manager = yield* Preview.make.pipe(
          Effect.provide(
            Layer.merge(
              ServerConfig.layerTest(process.cwd(), { prefix: "t3-preview-controls-" }).pipe(
                Layer.provide(NodeServices.layer),
              ),
              NodeCrypto.layer,
            ),
          ),
        );
        const broker = yield* PreviewAutomationBroker.make.pipe(
          Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
        );
        const closedTabs: Array<string | undefined> = [];
        const host = yield* broker.connect(
          { clientId: "chrome-host", environmentId, supportedOperations: ["close", "status"] },
          { serverHost: { preferred: () => Effect.succeed(true) } },
        );
        yield* Stream.runForEach(host, (event) => {
          if (event.type === "connected") {
            return broker.focusHost({
              clientId: "chrome-host",
              environmentId,
              connectionId: event.connectionId,
              focused: false,
              liveTabs: [{ threadId, tabId: PreviewTabId.make("chrome-open") }],
            });
          }
          if (event.request.operation === "status") {
            return broker.respond({
              clientId: "chrome-host",
              connectionId: event.connectionId,
              requestId: event.request.requestId,
              ok: true,
              result: { tabId: event.request.tabId, url: "http://localhost:5173/", title: "App" },
            });
          }
          closedTabs.push(event.request.tabId);
          const open = event.request.tabId === "chrome-open";
          return broker.respond({
            clientId: "chrome-host",
            connectionId: event.connectionId,
            requestId: event.request.requestId,
            ok: open,
            ...(open
              ? { result: {} }
              : {
                  error: {
                    _tag: "PreviewAutomationTabNotFoundError",
                    message: "Chrome tab chrome-gone is closed or unknown.",
                  },
                }),
          });
        }).pipe(Effect.forkScoped);
        yield* Effect.yieldNow;
        const layerDependencies = Layer.mergeAll(
          Layer.succeed(PreviewAutomationBroker.PreviewAutomationBroker, broker),
          Layer.succeed(Preview.PreviewManager, manager),
          Layer.succeed(McpInvocationContext.McpInvocationContext, scope),
          McpToolAccessTestkit.liveThreadsLayer,
          Layer.mock(ServerSettings.ServerSettingsService)({
            getSettings: Effect.succeed({
              ...DEFAULT_SERVER_SETTINGS,
              enableAgentBrowserAccess: true,
            }),
          }),
        );
        const toolkit = yield* PreviewControlsToolkit.pipe(
          Effect.provide(
            McpToolAccess.HandlersLayer.layer(PreviewControlsHandlers.layer).pipe(
              Layer.provide(layerDependencies),
            ),
          ),
        );
        const close = (tabId: string) =>
          toolkit
            .handle("t3_preview_close", { tabId: PreviewTabId.make(tabId) })
            .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(layerDependencies));

        const listed = yield* toolkit
          .handle("t3_preview_list", {})
          .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(layerDependencies));
        expect(listed.at(-1)?.result).toMatchObject({
          sessions: [
            {
              tabId: "chrome-open",
              runtime: "server",
              navStatus: { _tag: "Success", url: "http://localhost:5173/", title: "App" },
            },
          ],
        });

        expect((yield* close("chrome-open")).at(-1)?.result).toEqual({});
        expect((yield* close("chrome-gone")).at(-1)?.result).toEqual({});
        expect(closedTabs).toEqual(["chrome-open", "chrome-gone"]);
      }),
    ),
);
