import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { describe, expect } from "vite-plus/test";

import {
  createExperimentalDynamicToolRegistry,
  DynamicToolRegistryError,
} from "./DynamicToolRegistry.ts";

const registration = (namespace: string) => ({
  spec: {
    type: "function" as const,
    namespace,
    name: "task_get",
    description: "Load one task.",
    inputSchema: { type: "object" },
  },
  execute: () => {
    throw new Error("not used");
  },
});

describe("ExperimentalDynamicToolRegistry", () => {
  it("accepts Responses API-compatible namespaces", () => {
    expect(() =>
      createExperimentalDynamicToolRegistry([
        {
          ownerId: "upcomputer.tasks",
          version: 1,
          tools: [registration("upcomputer_tasks")],
        },
      ]),
    ).not.toThrow();
  });

  it.effect("fails closed before executing tools not explicitly classified as read-only", () => {
    let executions = 0;
    const registry = createExperimentalDynamicToolRegistry([
      {
        ownerId: "upcomputer.tasks",
        version: 1,
        tools: [
          {
            ...registration("upcomputer_tasks"),
            execute: () => {
              executions += 1;
              return Effect.succeed({ isError: false, text: "changed" });
            },
          },
        ],
      },
    ]);

    return Effect.gen(function* () {
      const result = yield* registry.execute(
        "task_get",
        {},
        { source: "provider", mutationPolicy: "deny" },
      );
      expect(result.isError).toBe(true);
      expect(result.text).toMatch(/Mutation denied/u);
      expect(executions).toBe(0);
    });
  });

  it("rejects dotted dynamic-tool namespaces", () => {
    expect(() =>
      createExperimentalDynamicToolRegistry([
        {
          ownerId: "upcomputer.tasks",
          version: 1,
          tools: [registration("upcomputer.tasks")],
        },
      ]),
    ).toThrow(DynamicToolRegistryError);
  });
});
