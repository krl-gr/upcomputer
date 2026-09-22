import { createExperimentalProductManifest } from "@upcomputer/shared/product";
import { describe, expect, it } from "vite-plus/test";

import {
  resolveConnectedWebFeatureAvailability,
  resolveWebFeatureAvailability,
} from "./environmentProduct";
import type { ExperimentalWebFeatureContribution } from "./WebFeature";

const feature = {
  id: "tasks",
  ownerId: "upcomputer.pro",
  version: 1,
} satisfies ExperimentalWebFeatureContribution;

describe("web feature availability", () => {
  it("waits for missing manifests and fails closed for absent extensions", () => {
    expect(resolveWebFeatureAvailability({ feature, manifest: undefined }).status).toBe("loading");
    expect(resolveWebFeatureAvailability({ feature, manifest: null }).status).toBe("unavailable");
    expect(
      resolveWebFeatureAvailability({
        feature,
        manifest: createExperimentalProductManifest({
          id: "upcomputer",
          displayName: "Upcomputer",
          version: "0.0.0",
        }),
      }).status,
    ).toBe("unavailable");
  });

  it("allows loading enabled and entitled extension UI", () => {
    const manifest = createExperimentalProductManifest({
      id: "upcomputer",
      displayName: "Upcomputer",
      version: "0.0.0",
      extensions: [
        {
          id: "tasks",
          displayName: "Tasks",
          description: "Task UI",
          version: "1.0.0",
          source: "official",
          availability: "paid",
          enabled: true,
          entitlement: { required: true, granted: true },
          capabilities: [{ id: "tasks.ui", version: 1 }],
        },
      ],
    });

    expect(
      resolveWebFeatureAvailability({
        feature,
        manifest,
        capabilities: [{ id: "tasks.ui", minimum: 1, maximum: 1 }],
      }),
    ).toMatchObject({ status: "operational", canLoad: true, canMutate: true });
  });

  it("selects the most permissive availability across connected environments", () => {
    const disabled = createExperimentalProductManifest({
      id: "upcomputer",
      displayName: "Upcomputer",
      version: "0.0.0",
      extensions: [
        {
          id: "tasks",
          displayName: "Tasks",
          description: "Task UI",
          version: "1.0.0",
          source: "official",
          availability: "free",
          enabled: false,
        },
      ],
    });
    const enabled = createExperimentalProductManifest({
      id: "upcomputer",
      displayName: "Upcomputer",
      version: "0.0.0",
      extensions: [
        {
          id: "tasks",
          displayName: "Tasks",
          description: "Task UI",
          version: "1.0.0",
          source: "official",
          availability: "free",
          enabled: true,
        },
      ],
    });

    expect(
      resolveConnectedWebFeatureAvailability({
        feature,
        manifests: [disabled, enabled],
      }),
    ).toMatchObject({ status: "operational", canLoad: true });
  });
});
