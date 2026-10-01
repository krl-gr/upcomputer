/* oxlint-disable upcomputer/no-manual-effect-runtime-in-tests -- imported node:test suite; migrate to it.effect separately. */
import * as NodeAssert from "node:assert/strict";
import { test } from "vite-plus/test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { makeClaudeDynamicToolMcpServers } from "../../../../apps/server/src/provider/Layers/ClaudeDynamicToolMcp.ts";
import {
  createExperimentalDynamicToolRegistry,
  ExperimentalDynamicToolRegistryService,
} from "../../../../apps/server/src/extensionApi.ts";
import { TaskToolService, type TaskToolServiceShape } from "./TaskToolServiceTag.ts";
import { TASK_TOOL_SPECS } from "./TaskToolDefinitions.ts";
import { makeTaskDynamicToolOwner, TaskDynamicToolRegistrationLive } from "./contribution.ts";

test("Tasks dynamic tools register into the public registry for the feature layer lifetime", async () => {
  const calls: Array<{
    readonly name: string;
    readonly args: Record<string, unknown>;
    readonly mutationPolicy: string;
  }> = [];
  const registry = createExperimentalDynamicToolRegistry();
  const service: TaskToolServiceShape = {
    call: ({ name, args, context }) =>
      Effect.sync(() => {
        calls.push({ name, args, mutationPolicy: context.mutationPolicy });
        return {
          isError: false,
          text: JSON.stringify({ name, args, mutationPolicy: context.mutationPolicy }),
        };
      }),
  };
  const layer = TaskDynamicToolRegistrationLive.pipe(
    Layer.provideMerge(Layer.succeed(TaskToolService, service)),
    Layer.provideMerge(Layer.succeed(ExperimentalDynamicToolRegistryService, registry)),
  );

  await Effect.runPromise(
    Effect.gen(function* () {
      const snapshot = registry.snapshot();
      NodeAssert.equal(snapshot.revision, 1);
      NodeAssert.deepEqual(snapshot.owners, [
        {
          ownerId: "upcomputer.tasks",
          version: 1,
          toolNames: TASK_TOOL_SPECS.map(({ name }) => name).sort(),
        },
      ]);
      NodeAssert.deepEqual(
        snapshot.specs.map(({ name }) => name),
        TASK_TOOL_SPECS.map(({ name }) => name).sort(),
      );

      const result = yield* registry
        .lease()
        .execute("task_get", { id: "task-1" }, { source: "provider", mutationPolicy: "deny" });
      NodeAssert.deepEqual(result, {
        isError: false,
        text: JSON.stringify({
          name: "task_get",
          args: { id: "task-1" },
          mutationPolicy: "deny",
        }),
      });
    }).pipe(Effect.provide(layer)),
  );

  NodeAssert.deepEqual(calls, [
    {
      name: "task_get",
      args: { id: "task-1" },
      mutationPolicy: "deny",
    },
  ]);
  NodeAssert.deepEqual(registry.snapshot(), { revision: 2, owners: [], specs: [] });
});

test("Claude MCP composes the real private task registration with per-turn mutation policy", async () => {
  const calls: Array<{ name: string; mutationPolicy: string; args: Record<string, unknown> }> = [];
  const service: TaskToolServiceShape = {
    call: ({ name, args, context }) =>
      Effect.sync(() => {
        calls.push({ name, args, mutationPolicy: context.mutationPolicy });
        const mutating = name === "task_update" || name === "task_event_append";
        return mutating && context.mutationPolicy === "deny"
          ? { isError: true, text: `Mutation denied for '${name}'.` }
          : { isError: false, text: JSON.stringify({ name, args }) };
      }),
  };
  const registry = createExperimentalDynamicToolRegistry([makeTaskDynamicToolOwner(service)]);
  let mutationPolicy: "allow" | "deny" = "deny";
  const servers = makeClaudeDynamicToolMcpServers({
    lease: registry.lease(),
    invocationContext: () => ({
      source: "provider",
      mutationPolicy,
      threadId: "thread-private-composed" as never,
      turnId: "turn-private-composed" as never,
      runtimeMode: "full-access",
      interactionMode: "default",
    }),
  });
  const server = servers.upcomputer_tasks;
  NodeAssert.ok(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "private-composed-test", version: "1" });
  await Promise.all([server.instance.connect(serverTransport), client.connect(clientTransport)]);

  const names = new Set((await client.listTools()).tools.map(({ name }) => name));
  for (const name of ["task_get", "agent_run_search", "task_update", "task_event_append"]) {
    NodeAssert.equal(names.has(name), true, `${name} should be exposed`);
  }

  NodeAssert.equal(
    (await client.callTool({ name: "task_get", arguments: { id: "task-1" } })).isError,
    false,
  );
  NodeAssert.equal(
    (await client.callTool({ name: "agent_run_search", arguments: { taskId: "task-1" } })).isError,
    false,
  );
  NodeAssert.equal(
    (await client.callTool({ name: "task_update", arguments: { id: "task-1" } })).isError,
    true,
  );
  NodeAssert.equal(
    (
      await client.callTool({
        name: "task_event_append",
        arguments: { taskId: "task-1", kind: "review" },
      })
    ).isError,
    true,
  );

  mutationPolicy = "allow";
  NodeAssert.equal(
    (await client.callTool({ name: "task_update", arguments: { id: "task-1" } })).isError,
    false,
  );
  NodeAssert.equal(
    (
      await client.callTool({
        name: "task_event_append",
        arguments: { taskId: "task-1", kind: "review" },
      })
    ).isError,
    false,
  );
  NodeAssert.deepEqual(
    calls.map(({ name, mutationPolicy: policy }) => [name, policy]),
    [
      ["task_get", "deny"],
      ["agent_run_search", "deny"],
      // Denied writes are rejected by the registry before TaskToolService.
      ["task_update", "allow"],
      ["task_event_append", "allow"],
    ],
  );
  await client.close();
});
