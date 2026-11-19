import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpServer } from "effect/ai";

import { ThreadManagementService } from "../../../../apps/server/src/extensionApi.ts";
import { enumsGeminiRejects } from "../../../../apps/server/src/mcp/geminiToolSchema.testkit.ts";
import { BotMcpToolsLive } from "../bots/BotMcpTools.ts";
import { BotService } from "../bots/BotService.ts";
import { TaskRepository } from "../persistence/TaskRepository.ts";
import { TaskToolService } from "../tools/TaskToolServiceTag.ts";
import { TaskMcpToolsLive } from "./TaskMcpTools.ts";

// Registration only stores tool definitions, so the handlers' services are never called.
const layer = Layer.merge(TaskMcpToolsLive, BotMcpToolsLive).pipe(
  Layer.provideMerge(McpServer.McpServer.layer),
  Layer.provide(
    Layer.mergeAll(
      Layer.mock(BotService)({}),
      Layer.mock(TaskRepository)({}),
      Layer.mock(TaskToolService)({}),
      Layer.mock(ThreadManagementService)({}),
    ),
  ),
);

it.effect("task and bot tools advertise only enums Gemini accepts", () =>
  Effect.gen(function* () {
    const { tools } = yield* McpServer.McpServer;
    expect(tools.map(({ tool }) => tool.name)).toEqual(
      expect.arrayContaining(["task_update", "bot_memory"]),
    );
    expect(tools.flatMap(({ tool }) => enumsGeminiRejects(tool.name, tool.inputSchema))).toEqual(
      [],
    );
  }).pipe(Effect.provide(layer)),
);
