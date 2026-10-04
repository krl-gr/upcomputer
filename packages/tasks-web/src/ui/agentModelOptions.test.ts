import * as NodeAssert from "node:assert/strict";
import { test } from "vite-plus/test";

import type { ProviderInstanceEntry } from "../../../../apps/web/src/providerInstances.ts";

import type { ScopedTaskAgent, ScopedTaskAgentRun } from "../state/index.ts";
import {
  getAgentModelLabel,
  getAgentModelOptionPresentation,
  getTaskRunAgentPresentation,
  retainValidAgentModelOptions,
} from "./agentModelOptions.ts";

function provider(): ProviderInstanceEntry {
  return {
    instanceId: "codex",
    driverKind: "codex",
    displayName: "Codex",
    enabled: true,
    installed: true,
    status: "ready",
    isDefault: true,
    isAvailable: true,
    snapshot: {},
    models: [
      {
        slug: "gpt-test",
        name: "GPT Test",
        isCustom: false,
        capabilities: {
          optionDescriptors: [
            {
              id: "reasoningEffort",
              label: "Thinking",
              type: "select",
              options: [
                { id: "medium", label: "Medium", isDefault: true },
                { id: "high", label: "High" },
              ],
            },
            {
              id: "serviceTier",
              label: "Speed",
              type: "select",
              options: [
                { id: "default", label: "Standard", isDefault: true },
                { id: "priority", label: "Fast" },
              ],
            },
          ],
        },
      },
      {
        slug: "plain",
        name: "Plain",
        isCustom: false,
        capabilities: { optionDescriptors: [] },
      },
    ],
  } as unknown as ProviderInstanceEntry;
}

test("presents advertised defaults without materializing stored options", () => {
  const options = undefined;
  NodeAssert.deepEqual(
    getAgentModelOptionPresentation({ provider: provider(), model: "gpt-test", options }),
    [
      { label: "Thinking", value: "Medium" },
      { label: "Speed", value: "Standard" },
    ],
  );
  NodeAssert.equal(options, undefined);
});

test("retains exact valid values and removes stale options after a model change", () => {
  const options = [
    { id: "reasoningEffort", value: "high" },
    { id: "serviceTier", value: "priority" },
    { id: "removed", value: true },
  ] as const;

  NodeAssert.deepEqual(
    retainValidAgentModelOptions({ provider: provider(), model: "gpt-test", options }),
    options.slice(0, 2),
  );
  NodeAssert.equal(
    retainValidAgentModelOptions({ provider: provider(), model: "plain", options }),
    undefined,
  );
});

test("labels a selection with the harness and model display names", () => {
  NodeAssert.equal(
    getAgentModelLabel([provider()], { instanceId: "codex", model: "gpt-test" } as never),
    "Codex · GPT Test",
  );
});

test("falls back to the slug where the catalog has no entry", () => {
  NodeAssert.equal(
    getAgentModelLabel([provider()], { instanceId: "codex", model: "gpt-gone" } as never),
    "Codex · gpt-gone",
  );
  NodeAssert.equal(
    getAgentModelLabel([provider()], { instanceId: "claudeAgent", model: "claude-x" } as never),
    "claude-x",
  );
  NodeAssert.equal(
    getAgentModelLabel(undefined, { instanceId: "codex", model: "gpt-test" } as never),
    "gpt-test",
  );
});

test("a run is labeled with its agent and its own model selection", () => {
  const agent = {
    id: "agent-1",
    environmentId: "local",
    name: "Reviewer",
    config: { modelSelection: { instanceId: "codex", model: "plain" } },
  } as unknown as ScopedTaskAgent;
  const run = {
    id: "run-1",
    environmentId: "local",
    agentId: "agent-1",
    modelSelection: { instanceId: "codex", model: "gpt-test" },
  } as unknown as ScopedTaskAgentRun;
  NodeAssert.deepEqual(getTaskRunAgentPresentation(run, [agent], [provider()]), {
    agentName: "Reviewer",
    modelLabel: "Codex · GPT Test",
  });
  NodeAssert.deepEqual(
    getTaskRunAgentPresentation({ ...run, environmentId: "remote" } as never, [agent], undefined),
    { agentName: "Agent run", modelLabel: "gpt-test" },
  );
});
