import { DEFAULT_SERVER_SETTINGS, EnvironmentId } from "@upcomputer/contracts";
import { describe, expect, it } from "@effect/vitest";

import {
  findSharedSettingsMismatches,
  pickSharedServerSettings,
  splitSharedServerPatch,
} from "./sharedSettings.ts";

const primaryId = EnvironmentId.make("env-primary");
const laptopId = EnvironmentId.make("env-laptop");
const boxId = EnvironmentId.make("env-box");

describe("splitSharedServerPatch", () => {
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
