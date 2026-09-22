import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  defaultInstanceIdForDriver,
} from "@upcomputer/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import type { ProviderDriver } from "../ProviderDriver.ts";
import { deriveProviderInstanceConfigMap } from "./ProviderInstanceRegistryHydration.ts";

const contributedKind = ProviderDriverKind.make("pi");
const contributedDriver = {
  driverKind: contributedKind,
  metadata: { displayName: "Pi" },
  configSchema: Schema.Struct({}),
  defaultConfig: () => ({}),
  create: () => Effect.die("not materialized by this pure test"),
} satisfies ProviderDriver<Record<string, never>>;

describe("ProviderInstanceRegistryHydration", () => {
  it("creates a deterministic default slot for a contributed driver without a legacy mirror", () => {
    const config = deriveProviderInstanceConfigMap(DEFAULT_SERVER_SETTINGS, [contributedDriver]);
    expect(config[defaultInstanceIdForDriver(contributedKind)]).toEqual({
      driver: contributedKind,
    });
  });
});
