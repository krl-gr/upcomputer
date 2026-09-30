import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@upcomputer/contracts";
import { describe, expect, it } from "@effect/vitest";

import {
  filterSharedServerPatch,
  findSharedSettingsMismatches,
  pickSharedServerSettings,
  splitSharedServerPatch,
} from "./sharedSettings.ts";

const primaryId = EnvironmentId.make("env-primary");
const laptopId = EnvironmentId.make("env-laptop");
const boxId = EnvironmentId.make("env-box");

describe("splitSharedServerPatch", () => {
  it.each([
    {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.6-sol",
      options: [{ id: "reasoningEffort", value: "low" }],
    },
    {
      instanceId: ProviderInstanceId.make("claudeAgent"),
      model: "claude-sonnet-4-6",
      options: [{ id: "effort", value: "high" }],
    },
    DEFAULT_SERVER_SETTINGS.textGenerationModelSelection,
  ])("shares the text generation model and options, including reset (%j)", (selection) => {
    const patch = { textGenerationModelSelection: selection };
    const enabledProviders = {
      ...DEFAULT_SERVER_SETTINGS,
      providers: {
        ...DEFAULT_SERVER_SETTINGS.providers,
        codex: { ...DEFAULT_SERVER_SETTINGS.providers.codex, enabled: true },
        claudeAgent: { ...DEFAULT_SERVER_SETTINGS.providers.claudeAgent, enabled: true },
      },
    };
    expect(splitSharedServerPatch(patch)).toEqual({ sharedPatch: patch, localPatch: {} });
    expect(pickSharedServerSettings({ ...enabledProviders, ...patch })).toMatchObject(patch);
    const environment = {
      environmentId: boxId,
      label: "Remote Box",
      connected: true,
      settings: {
        ...enabledProviders,
        textGenerationModelSelection: { ...selection, model: "different-model" },
      },
    };
    const input = {
      primaryEnvironmentId: primaryId,
      primarySettings: { ...enabledProviders, ...patch },
      environments: [environment],
    };
    expect(findSharedSettingsMismatches(input)).toEqual([
      { environmentId: boxId, label: "Remote Box" },
    ]);
    expect(
      findSharedSettingsMismatches({
        ...input,
        environments: [{ ...environment, settings: input.primarySettings }],
      }),
    ).toEqual([]);
  });

  it("routes preference keys to the shared patch and machine keys to the local patch", () => {
    const { sharedPatch, localPatch } = splitSharedServerPatch({
      defaultThreadEnvMode: "worktree",
      newWorktreesStartFromOrigin: false,
      enableAssistantStreaming: false,
    });
    expect(sharedPatch).toEqual({
      defaultThreadEnvMode: "worktree",
      newWorktreesStartFromOrigin: false,
    });
    expect(localPatch).toEqual({ enableAssistantStreaming: false });
  });
});

describe("pickSharedServerSettings", () => {
  it("returns only the shared keys", () => {
    expect(Object.keys(pickSharedServerSettings(DEFAULT_SERVER_SETTINGS)).sort()).toEqual([
      "defaultThreadEnvMode",
      "newWorktreesStartFromOrigin",
      "textGenerationModelSelection",
    ]);
  });
});

describe("findSharedSettingsMismatches", () => {
  const primarySettings = {
    ...DEFAULT_SERVER_SETTINGS,
    defaultThreadEnvMode: "worktree" as const,
  };

  it("lists connected environments whose shared settings differ", () => {
    const mismatches = findSharedSettingsMismatches({
      primaryEnvironmentId: primaryId,
      primarySettings,
      environments: [
        { environmentId: primaryId, label: "Desktop", connected: true, settings: primarySettings },
        { environmentId: laptopId, label: "Laptop", connected: true, settings: primarySettings },
        {
          environmentId: boxId,
          label: "Remote Box",
          connected: true,
          settings: DEFAULT_SERVER_SETTINGS,
        },
      ],
    });
    expect(mismatches).toEqual([{ environmentId: boxId, label: "Remote Box" }]);
  });

  it("ignores machine-only differences", () => {
    const mismatches = findSharedSettingsMismatches({
      primaryEnvironmentId: primaryId,
      primarySettings,
      environments: [
        {
          environmentId: boxId,
          label: "Remote Box",
          connected: true,
          settings: { ...primarySettings, enableAssistantStreaming: true },
        },
      ],
    });
    expect(mismatches).toEqual([]);
  });

  it("reports nothing until the primary environment's settings are loaded", () => {
    const environments = [
      { environmentId: boxId, label: "Remote Box", connected: true, settings: primarySettings },
    ];
    expect(
      findSharedSettingsMismatches({ primaryEnvironmentId: null, primarySettings, environments }),
    ).toEqual([]);
    expect(
      findSharedSettingsMismatches({
        primaryEnvironmentId: primaryId,
        primarySettings: null,
        environments,
      }),
    ).toEqual([]);
  });

  it("skips offline environments and environments without a loaded config", () => {
    const mismatches = findSharedSettingsMismatches({
      primaryEnvironmentId: primaryId,
      primarySettings,
      environments: [
        {
          environmentId: laptopId,
          label: "Laptop",
          connected: false,
          settings: DEFAULT_SERVER_SETTINGS,
        },
        { environmentId: boxId, label: "Remote Box", connected: true, settings: null },
      ],
    });
    expect(mismatches).toEqual([]);
  });
});

describe("filterSharedServerPatch", () => {
  it.each([true, false])(
    "resets a disabled default provider only on the originating environment (%s)",
    (targetIsSource) => {
      const settings = {
        ...DEFAULT_SERVER_SETTINGS,
        providerInstances: {
          codex: { driver: ProviderDriverKind.make("codex"), enabled: false, config: {} },
          claudeAgent: {
            driver: ProviderDriverKind.make("claudeAgent"),
            enabled: true,
            config: {},
          },
        },
        textGenerationModelSelection: {
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: "claude-opus-4-6",
        },
      };
      const patch = {
        textGenerationModelSelection: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection,
        newWorktreesStartFromOrigin: false,
      };
      expect(filterSharedServerPatch(patch, settings, settings, targetIsSource)).toEqual({
        ...(targetIsSource
          ? { textGenerationModelSelection: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection }
          : {}),
        newWorktreesStartFromOrigin: false,
      });
    },
  );

  it.each(["missing", "disabled", "different-driver", "enabled"] as const)(
    "shares a custom model only when its target provider is enabled (%s)",
    (availability) => {
      const instanceId = ProviderInstanceId.make("codex_personal");
      const selection = {
        instanceId,
        model: "gpt-5.6-luna",
        options: [{ id: "reasoningEffort", value: "low" }],
      };
      const instance = {
        driver: ProviderDriverKind.make(
          availability === "different-driver" ? "claudeAgent" : "codex",
        ),
        enabled: availability !== "disabled",
        config: {},
      };
      const settings = {
        ...DEFAULT_SERVER_SETTINGS,
        providerInstances: availability === "missing" ? {} : { [instanceId]: instance },
      };
      const patch = { newWorktreesStartFromOrigin: false, textGenerationModelSelection: selection };
      const sourceSettings = {
        ...settings,
        providerInstances: {
          [instanceId]: { ...instance, driver: ProviderDriverKind.make("codex"), enabled: true },
        },
      };
      expect(filterSharedServerPatch(patch, settings, sourceSettings)).toEqual(
        availability === "enabled" ? patch : { newWorktreesStartFromOrigin: false },
      );
      const primarySettings = {
        ...sourceSettings,
        textGenerationModelSelection: selection,
      };
      expect(
        findSharedSettingsMismatches({
          primaryEnvironmentId: primaryId,
          primarySettings,
          environments: [{ environmentId: boxId, label: "Remote Box", connected: true, settings }],
        }),
      ).toEqual(availability === "enabled" ? [{ environmentId: boxId, label: "Remote Box" }] : []);
    },
  );
});
