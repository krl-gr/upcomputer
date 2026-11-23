import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  PREVIEW_AUTOMATION_SERVER_OPERATIONS,
  PreviewTabId,
  ProviderInstanceId,
  ThreadId,
  type PreviewAutomationOperation,
  type PreviewAutomationStreamEvent,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as PreviewAutomationBroker from "./PreviewAutomationBroker.ts";

const environmentId = EnvironmentId.make("environment-1");
const threadId = ThreadId.make("thread-1");
const scope = {
  environmentId,
  requestNamespace: "provider-session-1",
  thread: {
    threadId,
    providerSessionId: "provider-session-1",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
  capabilities: new Set(["preview"] as const),
  issuedAt: 1,
};

/**
 * An environment browser and a Chrome server host that open a tab per open,
 * close the tab they are asked to, and report their tabs like the real hosts.
 */
const setup = Effect.gen(function* () {
  const broker = yield* PreviewAutomationBroker.make.pipe(
    Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
  );
  const state = { alwaysUseChrome: false, openedTabs: 0, served: [] as string[] };
  const serve = (clientId: string, events: Stream.Stream<PreviewAutomationStreamEvent>) => {
    const tabs = new Set<PreviewTabId>();
    return Stream.runForEach(events, (event) => {
      if (event.type !== "request") return Effect.void;
      const { request } = event;
      state.served.push(`${request.operation}:${clientId}`);
      let tabId = request.tabId ?? null;
      if (request.operation === "open" && tabId === null) {
        tabId = PreviewTabId.make(`${clientId}-${++state.openedTabs}`);
        tabs.add(tabId);
      }
      const known = tabId !== null && tabs.has(tabId);
      if (request.operation === "close" && tabId !== null) tabs.delete(tabId);
      return broker
        .focusHost({
          clientId,
          environmentId,
          connectionId: event.connectionId,
          focused: false,
          liveTabs: [...tabs].map((liveTabId) => ({ threadId, tabId: liveTabId })),
        })
        .pipe(
          Effect.andThen(
            broker.respond({
              clientId,
              connectionId: event.connectionId,
              requestId: request.requestId,
              ...(known
                ? { ok: true, result: request.operation === "close" ? {} : { tabId } }
                : {
                    ok: false,
                    error: { _tag: "PreviewAutomationTabNotFoundError", message: "unknown tab" },
                  }),
            }),
          ),
        );
    }).pipe(Effect.forkScoped);
  };
  const host = (clientId: string) => ({
    clientId,
    environmentId,
    supportedOperations: [...PREVIEW_AUTOMATION_SERVER_OPERATIONS],
  });
  yield* serve(
    "chrome",
    yield* broker.connect(host("chrome"), {
      serverHost: { preferred: () => Effect.sync(() => state.alwaysUseChrome) },
    }),
  );
  yield* serve(
    "environment-browser",
    yield* broker.connect(host("environment-browser"), { preferred: true }),
  );
  yield* Effect.yieldNow;
  const call = (operation: PreviewAutomationOperation, tabId?: string) =>
    broker.invoke({
      scope,
      operation,
      input: {},
      ...(tabId === undefined ? {} : { tabId: PreviewTabId.make(tabId) }),
    });
  return { state, call };
});

it.effect("closes a named tab in the host that has it while Chrome is preferred", () =>
  Effect.gen(function* () {
    const { state, call } = yield* setup;
    yield* call("open");
    state.alwaysUseChrome = true;
    yield* call("close", "environment-browser-1");
    expect(state.served).toEqual(["open:environment-browser", "close:environment-browser"]);
  }),
);

it.effect("closes a Chrome tab left open after Chrome stops being preferred", () =>
  Effect.gen(function* () {
    const { state, call } = yield* setup;
    state.alwaysUseChrome = true;
    yield* call("open");
    state.alwaysUseChrome = false;
    yield* call("open");
    yield* call("close", "chrome-1");
    // The close does not move the session off the environment browser.
    yield* call("status");
    expect(state.served).toEqual([
      "open:chrome",
      "open:environment-browser",
      "close:chrome",
      "status:environment-browser",
    ]);
  }),
);

it.effect("a server host's own reason reaches the agent", () =>
  Effect.gen(function* () {
    const broker = yield* PreviewAutomationBroker.make.pipe(
      Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
    );
    const events = yield* broker.connect(
      { clientId: "chrome", environmentId, supportedOperations: ["open"] },
      { serverHost: { preferred: () => Effect.succeed(true) } },
    );
    yield* Stream.runForEach(events, (event) =>
      event.type === "request"
        ? broker.respond({
            clientId: "chrome",
            connectionId: event.connectionId,
            requestId: event.request.requestId,
            ok: false,
            error: {
              _tag: "PreviewAutomationExecutionError",
              message: "Unable to find Chrome or Edge for UpComputer browser automation.",
            },
          })
        : Effect.void,
    ).pipe(Effect.forkScoped);
    yield* Effect.yieldNow;
    const failure = yield* broker
      .invoke<never>({ scope, operation: "open", input: {} })
      .pipe(Effect.flip);
    expect(failure._tag).toBe("PreviewAutomationExecutionError");
    expect(failure.message).toContain("Unable to find Chrome or Edge");
  }),
);
