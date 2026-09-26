import * as NodeAssert from "node:assert/strict";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";

import { OpenCodeRuntime, OpenCodeRuntimeLive } from "./opencodeRuntime.ts";

const testLayer = OpenCodeRuntimeLive.pipe(Layer.provideMerge(NodeServices.layer));

it.layer(testLayer)("OpenCodeRuntime inventory", (it) => {
  it.effect("aborts pending SDK requests when inventory loading is interrupted", () =>
    Effect.gen(function* () {
      const runtime = yield* OpenCodeRuntime;
      const started = yield* Queue.make<void>();
      const aborted = yield* Queue.make<string>();
      const client = createOpencodeClient({
        baseUrl: "http://opencode.test",
        fetch: Object.assign(
          (input: string | Request | URL) => {
            const request = input instanceof Request ? input : new Request(input.toString());
            return new Promise<Response>((_resolve, reject) => {
              request.signal.addEventListener(
                "abort",
                () => {
                  Queue.offerUnsafe(aborted, new URL(request.url).pathname);
                  reject(request.signal.reason);
                },
                { once: true },
              );
              Queue.offerUnsafe(started, undefined);
            });
          },
          { preconnect: () => undefined },
        ),
      });

      const inventoryFiber = yield* runtime.loadOpenCodeInventory(client).pipe(Effect.forkChild);
      yield* Queue.takeN(started, 2);
      yield* Fiber.interrupt(inventoryFiber);

      NodeAssert.deepEqual((yield* Queue.takeAll(aborted)).toSorted(), ["/agent", "/provider"]);
    }),
  );

  it.effect("keeps provider inventory when agent discovery fails", () =>
    Effect.gen(function* () {
      const runtime = yield* OpenCodeRuntime;
      const client = {
        provider: {
          list: () =>
            Promise.resolve({
              data: {
                connected: ["openai"],
                all: [],
                default: {},
              },
            }),
        },
        app: {
          agents: () => Promise.reject(new Error("agents endpoint unavailable")),
        },
      } as unknown as OpencodeClient;

      const inventory = yield* runtime.loadOpenCodeInventory(client);

      NodeAssert.deepEqual(inventory.providerList.connected, ["openai"]);
      NodeAssert.deepEqual(inventory.agents, []);
    }),
  );
});
