import { describe, expect, it } from "vite-plus/test";

import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { ProviderInstanceId, type ModelSelection, type ServerConfig } from "@t3tools/contracts";

import { resolveExistingThreadModelSelection } from "./effectiveThreadModelSelection";

const persistedSelection: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex_personal"),
  model: "personal-model",
  options: [{ id: "reasoningEffort", value: "high" }],
};

const boundSelection: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex_work"),
  model: "work-default",
};

const serverConfig = {
  providers: [
    {
      instanceId: "codex_work",
      driver: "codex",
      displayName: "Codex Work",
      enabled: true,
      installed: true,
      auth: { status: "authenticated" },
      models: [
        {
          slug: "work-default",
          name: "Work Default",
          isDefault: true,
          isCustom: false,
          capabilities: null,
        },
      ],
    },
  ],
} as unknown as ServerConfig;

function thread(input: {
  readonly started: boolean;
  readonly sessionInstanceId?: string;
}): Pick<EnvironmentThreadShell, "latestTurn" | "modelSelection" | "session"> {
  return {
    modelSelection: persistedSelection,
    latestTurn: input.started ? ({} as EnvironmentThreadShell["latestTurn"]) : null,
    session:
      input.sessionInstanceId === undefined
        ? null
        : ({
            providerInstanceId: ProviderInstanceId.make(input.sessionInstanceId),
          } as EnvironmentThreadShell["session"]),
  };
}

describe("existing thread model selection", () => {
  it("binds a historical started-thread mismatch to the session instance's canonical default", () => {
    expect(
      resolveExistingThreadModelSelection({
        thread: thread({ started: true, sessionInstanceId: "codex_work" }),
        selectedModelSelection: persistedSelection,
        serverConfig,
      }),
    ).toEqual(boundSelection);
  });

  it("preserves and normalizes a compatible same-model selection on the bound instance", () => {
    const sharedModelConfig = {
      providers: [
        {
          instanceId: "codex_work",
          driver: "codex",
          enabled: true,
          installed: true,
          auth: { status: "authenticated" },
          models: [
            {
              slug: "personal-model",
              name: "Shared Model",
              isDefault: true,
              capabilities: {
                optionDescriptors: [
                  {
                    id: "reasoningEffort",
                    label: "Reasoning",
                    type: "select",
                    options: [
                      { id: "medium", label: "Medium", isDefault: true },
                      { id: "high", label: "High" },
                    ],
                    currentValue: "medium",
                  },
                  {
                    id: "serviceTier",
                    label: "Service Tier",
                    type: "select",
                    options: [{ id: "default", label: "Standard", isDefault: true }],
                    currentValue: "default",
                  },
                ],
              },
            },
          ],
        },
      ],
    } as unknown as ServerConfig;

    expect(
      resolveExistingThreadModelSelection({
        thread: thread({ started: true, sessionInstanceId: "codex_work" }),
        selectedModelSelection: persistedSelection,
        serverConfig: sharedModelConfig,
      }),
    ).toEqual({
      instanceId: ProviderInstanceId.make("codex_work"),
      model: "personal-model",
      options: [
        { id: "reasoningEffort", value: "high" },
        { id: "serviceTier", value: "default" },
      ],
    });
  });

  it("preserves a matching started-thread selection byte-for-byte", () => {
    const matching = {
      ...boundSelection,
      options: [{ id: "reasoningEffort", value: "medium" }],
    } satisfies ModelSelection;

    expect(
      resolveExistingThreadModelSelection({
        thread: thread({ started: true, sessionInstanceId: "codex_work" }),
        selectedModelSelection: matching,
        serverConfig: null,
      }),
    ).toBe(matching);
  });

  it("preserves the user's selected instance, model, and options before a thread starts", () => {
    const selected = {
      instanceId: ProviderInstanceId.make("other"),
      model: "other-model",
      options: [{ id: "fastMode", value: true }],
    } satisfies ModelSelection;

    expect(
      resolveExistingThreadModelSelection({
        thread: thread({ started: false }),
        selectedModelSelection: selected,
        serverConfig: null,
      }),
    ).toBe(selected);
  });

  it("waits rather than constructing a cross-instance payload when catalog state is unavailable", () => {
    expect(
      resolveExistingThreadModelSelection({
        thread: thread({ started: true, sessionInstanceId: "codex_work" }),
        selectedModelSelection: persistedSelection,
        serverConfig: null,
      }),
    ).toBeNull();
  });
});
