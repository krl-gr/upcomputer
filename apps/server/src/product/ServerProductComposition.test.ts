import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import * as Schema from "effect/Schema";
import { InteractionModeRegistryError } from "@upcomputer/shared/interactionMode";
import { ProviderDriverKind } from "@upcomputer/contracts";

import {
  CORE_SERVER_PRODUCT_COMPOSITION,
  ServerProductCompositionInvariantError,
  createExperimentalServerProductComposition,
  defineExperimentalServerFeature,
  eraseExperimentalServerLayer,
} from "./ServerProductComposition.ts";
import type { AnyProviderDriver } from "../provider/ProviderDriver.ts";
import { CORE_SERVER_PRODUCT_ENTRY } from "./defaultProductEntry.ts";
import { defineNamespacedRpcContribution } from "./RpcContribution.ts";

const CompositionTestRpc = Rpc.make("upcomputer.tasks.ping", {
  payload: Schema.String,
  success: Schema.String,
});
const CompositionTestRpcGroup = RpcGroup.make(CompositionTestRpc);
const TEST_PREVIEW_AUTOMATION_HOST = {
  id: "chrome",
  ownerId: "upcomputer.tasks",
  version: 1,
  make: Effect.succeed({
    supportedOperations: ["status"] as const,
    preferred: Effect.succeed(false),
    execute: () => Effect.succeed(null),
  }),
};
const TEST_PROVIDER_DRIVER = {
  driverKind: ProviderDriverKind.make("upcomputerAgent"),
  metadata: { displayName: "UpComputer Agent", supportsMultipleInstances: false },
  configSchema: Schema.Struct({}),
  defaultConfig: () => ({}),
  create: () => Effect.die(new Error("Composition tests do not materialize provider drivers.")),
} satisfies AnyProviderDriver<never>;

describe("server product composition", () => {
  it("keeps the public core features empty and exposes built-in interaction modes", () => {
    expect(CORE_SERVER_PRODUCT_COMPOSITION.features).toEqual([]);
    expect(CORE_SERVER_PRODUCT_COMPOSITION.diagnostics).toEqual([]);
    expect(CORE_SERVER_PRODUCT_COMPOSITION.migrations).toEqual([]);
    expect(CORE_SERVER_PRODUCT_COMPOSITION.providerDrivers).toEqual([]);
    expect(CORE_SERVER_PRODUCT_COMPOSITION.previewAutomationHosts).toEqual([]);
    expect(
      CORE_SERVER_PRODUCT_COMPOSITION.interactionModeRegistry.snapshot().map((mode) => mode.id),
    ).toEqual(["ask", "default", "plan"]);
    expect(CORE_SERVER_PRODUCT_ENTRY.composition).toBe(CORE_SERVER_PRODUCT_COMPOSITION);
    expect(CORE_SERVER_PRODUCT_ENTRY.manifest.id).toBe("upcomputer");
  });

  it("sorts server features deterministically", () => {
    const composition = createExperimentalServerProductComposition({
      features: [
        defineExperimentalServerFeature({ id: "upcomputer.tasks", version: 2 }),
        defineExperimentalServerFeature({ id: "upcomputer.agents", version: 1 }),
      ],
    });

    expect(composition.features.map((feature) => feature.id)).toEqual([
      "upcomputer.agents",
      "upcomputer.tasks",
    ]);
    expect(composition.diagnostics).toEqual([
      {
        id: "upcomputer.agents",
        version: 1,
        layers: 0,
        httpRoutes: 0,
        migrationNamespaces: 0,
        rpcNamespaces: 0,
        dynamicTools: 0,
        interactionModes: 0,
        providerDrivers: 0,
        interactionModeProviders: 0,
        previewAutomationHosts: 0,
      },
      {
        id: "upcomputer.tasks",
        version: 2,
        layers: 0,
        httpRoutes: 0,
        migrationNamespaces: 0,
        rpcNamespaces: 0,
        dynamicTools: 0,
        interactionModes: 0,
        providerDrivers: 0,
        interactionModeProviders: 0,
        previewAutomationHosts: 0,
      },
    ]);
  });

  it("collects feature layers, migrations, and RPC contributions", () => {
    const layer = eraseExperimentalServerLayer(Layer.effectDiscard(Effect.void));
    const migration = {
      ownerId: "upcomputer.tasks",
      namespace: "upcomputer.tasks",
      migrations: [
        {
          version: 1,
          name: "CreateTaskStorage",
          run: Effect.void,
        },
      ],
    };
    const rpc = defineNamespacedRpcContribution({
      id: "tasks-rpc-v1",
      ownerId: "upcomputer.tasks",
      version: 1,
      namespace: "upcomputer.tasks",
      group: CompositionTestRpcGroup,
      handlers: () =>
        CompositionTestRpcGroup.toLayer(
          CompositionTestRpcGroup.of({
            "upcomputer.tasks.ping": (input) => Effect.succeed(input),
          }),
        ),
    });
    const taskReviewMode = {
      descriptor: {
        id: "task-review",
        ownerId: "upcomputer.tasks",
        version: 1,
        displayName: "Task Review",
        description: "Review task state without implementing changes.",
        intent: "answer",
        safety: {
          mutations: "deny",
          sandbox: "read-only",
          computerUse: "observe-only",
        },
        outputKind: "plain",
        supportedProviders: ["codex"],
        unsupportedProviderBehavior: "reject",
        providerBehaviors: [
          {
            providerId: "codex",
            collaborationMode: "default",
            sandbox: "read-only",
            developerInstructions: "Review task state without implementing changes.",
          },
        ],
      },
    } as const;

    const composition = createExperimentalServerProductComposition({
      features: [
        {
          id: "upcomputer.tasks",
          version: 1,
          layers: [{ id: "tasks-runtime", ownerId: "upcomputer.tasks", version: 1, layer }],
          migrations: [migration],
          rpc: [rpc],
          interactionModes: [taskReviewMode],
          providerDrivers: [
            {
              id: "upcomputer-agent",
              ownerId: "upcomputer.tasks",
              version: 1,
              driver: TEST_PROVIDER_DRIVER,
            },
          ],
          interactionModeProviders: [
            {
              id: "pi-task-review",
              ownerId: "upcomputer.tasks",
              version: 1,
              modeId: "task-review",
              behavior: {
                providerId: "pi",
                promptPrefix: "Review task state without making changes.",
              },
            },
          ],
          previewAutomationHosts: [TEST_PREVIEW_AUTOMATION_HOST],
        },
      ],
    });

    expect(composition.diagnostics).toEqual([
      {
        id: "upcomputer.tasks",
        version: 1,
        layers: 1,
        httpRoutes: 0,
        migrationNamespaces: 1,
        rpcNamespaces: 1,
        dynamicTools: 0,
        interactionModes: 1,
        providerDrivers: 1,
        interactionModeProviders: 1,
        previewAutomationHosts: 1,
      },
    ]);
    expect(composition.migrations).toEqual([migration]);
    expect(composition.rpc).toEqual([rpc]);
    expect(composition.providerDrivers).toEqual([TEST_PROVIDER_DRIVER]);
    expect(composition.previewAutomationHosts).toEqual([TEST_PREVIEW_AUTOMATION_HOST]);
    const resolvedMode = composition.interactionModeRegistry.resolveOrThrow("task-review", "codex");
    expect(resolvedMode.ownerId).toBe("upcomputer.tasks");
    expect(resolvedMode.provider.sandbox).toBe("read-only");
    expect(
      composition.interactionModeRegistry.resolveOrThrow("task-review", "pi").provider.promptPrefix,
    ).toBe("Review task state without making changes.");
  });

  it("rejects ambiguous server feature registrations", () => {
    expect(() =>
      createExperimentalServerProductComposition({
        features: [
          { id: "upcomputer.tasks", version: 1 },
          { id: "upcomputer.tasks", version: 2 },
        ],
      }),
    ).toThrow(ServerProductCompositionInvariantError);

    expect(() => defineExperimentalServerFeature({ id: "Upcomputer.Tasks", version: 1 })).toThrow(
      ServerProductCompositionInvariantError,
    );

    expect(() => defineExperimentalServerFeature({ id: "upcomputer.core", version: 1 })).toThrow(
      ServerProductCompositionInvariantError,
    );

    expect(() =>
      createExperimentalServerProductComposition({
        features: [
          {
            id: "upcomputer.tasks",
            version: 1,
            layers: [
              {
                id: "tasks-runtime",
                ownerId: "upcomputer.other",
                version: 1,
                layer: eraseExperimentalServerLayer(Layer.empty),
              },
            ],
          },
        ],
      }),
    ).toThrow(ServerProductCompositionInvariantError);

    expect(() =>
      createExperimentalServerProductComposition({
        features: [
          {
            id: "upcomputer.tasks",
            version: 1,
            rpc: [
              defineNamespacedRpcContribution({
                id: "tasks-rpc-v1",
                ownerId: "upcomputer.other",
                version: 1,
                namespace: "upcomputer.tasks",
                group: CompositionTestRpcGroup,
                handlers: () => Layer.empty as never,
              }),
            ],
          },
        ],
      }),
    ).toThrow(ServerProductCompositionInvariantError);

    expect(() =>
      createExperimentalServerProductComposition({
        features: [
          {
            id: "upcomputer.tasks",
            version: 1,
            interactionModes: [
              {
                descriptor: {
                  id: "task-review",
                  ownerId: "upcomputer.other",
                  version: 1,
                  displayName: "Task Review",
                  description: "Review task state without implementing changes.",
                  intent: "answer",
                  safety: {
                    mutations: "deny",
                    sandbox: "read-only",
                    computerUse: "observe-only",
                  },
                  outputKind: "plain",
                  supportedProviders: ["codex"],
                  unsupportedProviderBehavior: "reject",
                  providerBehaviors: [
                    {
                      providerId: "codex",
                      collaborationMode: "default",
                      sandbox: "read-only",
                      developerInstructions: "Review only.",
                    },
                  ],
                },
              },
            ],
          },
        ],
      }),
    ).toThrow(ServerProductCompositionInvariantError);

    expect(() =>
      createExperimentalServerProductComposition({
        features: [
          {
            id: "upcomputer.tasks",
            version: 1,
            interactionModes: [
              {
                descriptor: {
                  id: "ask",
                  ownerId: "upcomputer.tasks",
                  version: 1,
                  displayName: "Ask",
                  description: "Duplicate the core Ask mode.",
                  intent: "answer",
                  safety: {
                    mutations: "deny",
                    sandbox: "read-only",
                    computerUse: "observe-only",
                  },
                  outputKind: "plain",
                  supportedProviders: ["codex"],
                  unsupportedProviderBehavior: "reject",
                  providerBehaviors: [
                    {
                      providerId: "codex",
                      collaborationMode: "default",
                      sandbox: "read-only",
                      developerInstructions: "Review only.",
                    },
                  ],
                },
              },
            ],
          },
        ],
      }),
    ).toThrow(InteractionModeRegistryError);

    expect(() =>
      createExperimentalServerProductComposition({
        features: [
          {
            id: "upcomputer.tasks",
            version: 1,
            providerDrivers: [
              {
                id: "codex-override",
                ownerId: "upcomputer.tasks",
                version: 1,
                driver: { ...TEST_PROVIDER_DRIVER, driverKind: ProviderDriverKind.make("codex") },
              },
            ],
          },
        ],
      }),
    ).toThrow(ServerProductCompositionInvariantError);

    for (const previewAutomationHosts of [
      [{ ...TEST_PREVIEW_AUTOMATION_HOST, ownerId: "upcomputer.other" }],
      [TEST_PREVIEW_AUTOMATION_HOST, TEST_PREVIEW_AUTOMATION_HOST],
      [{ ...TEST_PREVIEW_AUTOMATION_HOST, id: "Chrome" }],
      [{ ...TEST_PREVIEW_AUTOMATION_HOST, version: 0 }],
    ]) {
      expect(() =>
        createExperimentalServerProductComposition({
          features: [{ id: "upcomputer.tasks", version: 1, previewAutomationHosts }],
        }),
      ).toThrow(ServerProductCompositionInvariantError);
    }
  });
});
