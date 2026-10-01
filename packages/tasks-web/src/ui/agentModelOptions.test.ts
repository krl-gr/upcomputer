import * as NodeAssert from "node:assert/strict";
import { test } from "vite-plus/test";

import type { ProviderInstanceEntry } from "../../../../apps/web/src/providerInstances.ts";

import {
  getAgentModelOptionPresentation,
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
