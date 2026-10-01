import { describe, expect, it } from "vite-plus/test";
import { COMPUTER_USE_RPC_NAMESPACE } from "@upcomputer/computer-use-contracts/rpc";
import {
  TASK_AGENTS_RPC_NAMESPACE,
  TASKS_RPC_CAPABILITY_ID,
  TASKS_RPC_CONTRACT_VERSION,
  TASKS_RPC_NAMESPACE,
} from "@upcomputer/tasks-contracts/v1";

import { PUBLIC_SERVER_PRODUCT_ENTRY } from "./publicProductEntry.ts";

const { composition, manifest } = PUBLIC_SERVER_PRODUCT_ENTRY;

describe("public server product entry", () => {
  it("composes the open-source features with their manifest capabilities", () => {
    expect(composition.features.map((feature) => feature.id)).toEqual([
      "upcomputer.computer-use",
      "upcomputer.orchestrator",
      "upcomputer.tasks",
    ]);
    expect(composition.migrations.map((migration) => migration.ownerId)).toEqual([
      "upcomputer.tasks",
      "upcomputer.tasks",
    ]);
    expect(composition.rpc.map((contribution) => contribution.namespace)).toEqual(
      expect.arrayContaining([
        COMPUTER_USE_RPC_NAMESPACE,
        TASKS_RPC_NAMESPACE,
        TASK_AGENTS_RPC_NAMESPACE,
      ]),
    );
    expect(composition.previewAutomationHosts.map(({ ownerId, id }) => `${ownerId}:${id}`)).toEqual(
      ["upcomputer.computer-use:chrome"],
    );
    expect(composition.mcpTools.map(({ ownerId, id }) => `${ownerId}:${id}`)).toEqual([
      "upcomputer.computer-use:computer-use-tools",
    ]);
    expect(composition.interactionModeRegistry.snapshot().map((mode) => mode.id)).toContain(
      "orchestrator",
    );

    expect(
      manifest.capabilities.find((capability) => capability.id === TASKS_RPC_CAPABILITY_ID),
    ).toEqual({
      id: TASKS_RPC_CAPABILITY_ID,
      version: TASKS_RPC_CONTRACT_VERSION,
      ownerId: "upcomputer.tasks",
    });
    expect(manifest.extensions.map(({ id, state }) => ({ id, state }))).toEqual([
      { id: "upcomputer.computer-use", state: "enabled-free" },
      { id: "upcomputer.orchestrator", state: "enabled-free" },
      { id: "upcomputer.tasks", state: "enabled-free" },
    ]);
  });
});
