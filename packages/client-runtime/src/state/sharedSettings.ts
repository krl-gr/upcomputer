/**
 * Shared server settings.
 *
 * Every server keeps its own `settings.json`, but some keys are user
 * preferences that only live on the server because new threads on that
 * server read them. A user does not want those to differ per machine. Clients write these keys to every connected
 * environment, and warn when a connected environment still holds a different
 * value so the user can push their current value out.
 */
import type { EnvironmentId, ServerSettings, ServerSettingsPatch } from "@upcomputer/contracts";
import { isModelSelectionProviderEnabled } from "@upcomputer/shared/serverSettings";
import * as Equal from "effect/Equal";
import * as Struct from "effect/Struct";

/** Server keys that hold a user preference rather than machine config. */
export const SHARED_SERVER_SETTING_KEYS = [
  "defaultThreadEnvMode",
  "newWorktreesStartFromOrigin",
  "textGenerationModelSelection",
] as const satisfies ReadonlyArray<keyof ServerSettings & keyof ServerSettingsPatch>;

export type SharedServerSettingKey = (typeof SHARED_SERVER_SETTING_KEYS)[number];

const SHARED_KEY_SET = new Set<string>(SHARED_SERVER_SETTING_KEYS);

/** Split a server patch into the keys every environment should receive and the primary-only rest. */
export function splitSharedServerPatch(patch: ServerSettingsPatch): {
  sharedPatch: ServerSettingsPatch;
  localPatch: ServerSettingsPatch;
} {
  const sharedPatch: Record<string, unknown> = {};
  const localPatch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (SHARED_KEY_SET.has(key)) {
      sharedPatch[key] = value;
    } else {
      localPatch[key] = value;
    }
  }
  return {
    sharedPatch: sharedPatch as ServerSettingsPatch,
    localPatch: localPatch as ServerSettingsPatch,
  };
}

/**
 * Drop the text generation model for a target that cannot run it: the
 * instance is missing or disabled there, or the same instance id belongs to a
 * different driver. Writes to the originating environment keep the server's
 * own fallback behavior.
 */
export function filterSharedServerPatch(
  patch: ServerSettingsPatch,
  settings?: ServerSettings,
  sourceSettings = settings,
  targetIsSource = false,
): ServerSettingsPatch {
  const instanceId =
    patch.textGenerationModelSelection?.instanceId ??
    sourceSettings?.textGenerationModelSelection.instanceId;
  if (
    !targetIsSource &&
    patch.textGenerationModelSelection &&
    (!settings ||
      (instanceId !== undefined &&
        (sourceSettings?.providerInstances[instanceId]?.driver ?? instanceId) !==
          (settings.providerInstances[instanceId]?.driver ?? instanceId)) ||
      !isModelSelectionProviderEnabled(settings, {
        ...settings.textGenerationModelSelection,
        ...patch.textGenerationModelSelection,
      }))
  ) {
    return Struct.omit(patch, ["textGenerationModelSelection"]);
  }
  return patch;
}

/** The shared subset of one environment's settings, as a patch that can be written elsewhere. */
export function pickSharedServerSettings(settings: ServerSettings): ServerSettingsPatch {
  return filterSharedServerPatch(Struct.pick(settings, SHARED_SERVER_SETTING_KEYS), settings);
}

export interface SharedSettingsEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly connected: boolean;
  readonly settings: ServerSettings | null;
}

/**
 * Connected environments whose shared settings differ from the primary
 * environment's. Offline environments are skipped: nothing can be read from
 * or written to them, and the warning would never clear. With no primary
 * settings loaded there is nothing to compare against, so nothing is
 * reported. Callers must pass the real loaded settings, never a default
 * fallback, or "apply to all" would push defaults over real values.
 */
export function findSharedSettingsMismatches(input: {
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly primarySettings: ServerSettings | null;
  readonly environments: ReadonlyArray<SharedSettingsEnvironment>;
}): ReadonlyArray<{ readonly environmentId: EnvironmentId; readonly label: string }> {
  if (input.primaryEnvironmentId === null || input.primarySettings === null) {
    return [];
  }
  const primarySettings = input.primarySettings;
  const primaryShared = pickSharedServerSettings(primarySettings);
  return input.environments.flatMap((environment) => {
    if (
      environment.environmentId === input.primaryEnvironmentId ||
      !environment.connected ||
      environment.settings === null
    ) {
      return [];
    }
    const expected = filterSharedServerPatch(primaryShared, environment.settings, primarySettings);
    let actual = pickSharedServerSettings(environment.settings);
    // A model the target cannot run is never pushed, so it is not a mismatch.
    if (!expected.textGenerationModelSelection) {
      actual = Struct.omit(actual, ["textGenerationModelSelection"]);
    }
    return Equal.equals(actual, expected)
      ? []
      : [{ environmentId: environment.environmentId, label: environment.label }];
  });
}
