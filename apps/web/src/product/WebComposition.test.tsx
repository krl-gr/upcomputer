import { describe, expect, it } from "vite-plus/test";

import {
  CORE_WEB_PRODUCT_COMPOSITION,
  createExperimentalWebProductComposition,
  listExperimentalWebNavigation,
  listExperimentalWebProviderDrivers,
  listExperimentalWebRoutes,
  listExperimentalWebSettings,
} from "./WebComposition";
import { WebFeatureInvariantError } from "./WebFeature";
import { ProviderDriverKind } from "@upcomputer/contracts";
import * as Schema from "effect/Schema";

const loadRoute = async () => ({ default: () => null });

describe("web product composition", () => {
  it("uses an empty public composition by default", () => {
    expect(CORE_WEB_PRODUCT_COMPOSITION.features).toEqual([]);
    expect(listExperimentalWebRoutes(CORE_WEB_PRODUCT_COMPOSITION)).toEqual([]);
    expect(listExperimentalWebSettings(CORE_WEB_PRODUCT_COMPOSITION)).toEqual([]);
    expect(
      listExperimentalWebNavigation(CORE_WEB_PRODUCT_COMPOSITION, "primary-after-project"),
    ).toEqual([]);
  });

  it("sorts trusted route, settings, and navigation contributions deterministically", () => {
    const composition = createExperimentalWebProductComposition({
      features: [
        {
          id: "zeta",
          ownerId: "upcomputer.pro",
          version: 1,
          routes: [{ id: "tasks", path: "/tasks", load: loadRoute }],
          navigation: [
            {
              id: "tasks",
              label: "Tasks",
              path: "/tasks",
              slot: "primary-after-project",
              order: 20,
            },
          ],
          settings: [
            {
              id: "computer-use",
              label: "Computer Use",
              path: "/settings/computer-use",
              order: 20,
              load: loadRoute,
            },
          ],
        },
        {
          id: "alpha",
          ownerId: "upcomputer.pro",
          version: 1,
          routes: [{ id: "agents", path: "/agents", load: loadRoute }],
          navigation: [
            {
              id: "agents",
              label: "Agents",
              path: "/agents",
              slot: "primary-after-project",
              order: 10,
            },
          ],
          settings: [
            {
              id: "browser",
              label: "Browser",
              path: "/settings/browser",
              order: 10,
              load: loadRoute,
            },
          ],
        },
      ],
    });

    expect(composition.features.map((feature) => feature.id)).toEqual(["alpha", "zeta"]);
    expect(listExperimentalWebRoutes(composition).map(({ route }) => route.path)).toEqual([
      "/agents",
      "/tasks",
    ]);
    expect(
      listExperimentalWebNavigation(composition, "primary-after-project").map(
        ({ item }) => item.id,
      ),
    ).toEqual(["agents", "tasks"]);
    expect(listExperimentalWebSettings(composition).map(({ page }) => page.id)).toEqual([
      "browser",
      "computer-use",
    ]);
  });

  it("fails closed for ambiguous route and navigation registrations", () => {
    expect(() =>
      createExperimentalWebProductComposition({
        features: [
          {
            id: "one",
            ownerId: "upcomputer.pro",
            version: 1,
            routes: [{ id: "tasks", path: "/tasks", load: loadRoute }],
          },
          {
            id: "two",
            ownerId: "upcomputer.pro",
            version: 1,
            routes: [{ id: "tasks", path: "/activity", load: loadRoute }],
          },
        ],
      }),
    ).toThrowError(WebFeatureInvariantError);

    expect(() =>
      createExperimentalWebProductComposition({
        features: [
          {
            id: "bad",
            ownerId: "upcomputer.pro",
            version: 1,
            navigation: [
              {
                id: "tasks",
                label: "Tasks",
                path: "/tasks",
                slot: "primary-after-project",
              },
              {
                id: "tasks",
                label: "Tasks",
                path: "/tasks",
                slot: "primary-after-project",
              },
            ],
          },
        ],
      }),
    ).toThrowError(WebFeatureInvariantError);

    expect(() =>
      createExperimentalWebProductComposition({
        features: [
          {
            id: "one",
            ownerId: "upcomputer.pro",
            version: 1,
            settings: [
              {
                id: "browser",
                label: "Browser",
                path: "/settings/browser",
                load: loadRoute,
              },
            ],
          },
          {
            id: "two",
            ownerId: "upcomputer.pro",
            version: 1,
            settings: [
              {
                id: "browser-again",
                label: "Browser",
                path: "/settings/browser",
                load: loadRoute,
              },
            ],
          },
        ],
      }),
    ).toThrowError(WebFeatureInvariantError);
  });

  it("composes contributed provider driver presentation and rejects duplicate kinds", () => {
    const provider = {
      id: "pi",
      driverKind: ProviderDriverKind.make("pi"),
      label: "Pi",
      icon: () => null,
      settingsSchema: Schema.Struct({}),
    };
    const composition = createExperimentalWebProductComposition({
      features: [
        {
          id: "upcomputer.agent-runtime.web",
          ownerId: "upcomputer.agent-runtime",
          version: 1,
          providerDrivers: [provider],
        },
      ],
    });

    expect(
      listExperimentalWebProviderDrivers(composition).map(({ provider }) => provider.label),
    ).toEqual(["Pi"]);
    expect(() =>
      createExperimentalWebProductComposition({
        features: [
          {
            id: "one",
            ownerId: "upcomputer.pro",
            version: 1,
            providerDrivers: [provider],
          },
          {
            id: "two",
            ownerId: "upcomputer.pro",
            version: 1,
            providerDrivers: [{ ...provider, id: "pi-again" }],
          },
        ],
      }),
    ).toThrowError(WebFeatureInvariantError);
  });
});
