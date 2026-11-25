import { EnvironmentId, type TelemetryPreference } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import { UsageDataSettingRow } from "../components/settings/UsageDataSetting";
import { captureUiStateSheet, type UiState } from "./uiStateSheet";

/*
 * The "Share anonymous usage data" switch in Settings > About: on, off, and
 * locked by an environment variable or an organization's policy.
 */

const source = vi.hoisted(() => ({
  preference: { enabled: true, lockedBy: null } as TelemetryPreference,
  policyOrganization: null as string | null,
}));

// Data sources, not UI: the server's saved choice and the primary environment's policy.
vi.mock("../state/server", async (importOriginal) => {
  const original = await importOriginal<typeof import("../state/server")>();
  const { Atom } = await import("effect/reactivity");
  const allowed = Atom.make(true);
  return {
    ...original,
    serverEnvironment: {
      ...original.serverEnvironment,
      getTelemetryPreference: { kind: "get" },
      setTelemetryPreference: { kind: "set", permissionAtom: () => allowed },
    },
  };
});
vi.mock("../state/use-atom-command", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAtomCommand: (command: { readonly kind?: string }) => async () =>
    command.kind === "get"
      ? { _tag: "Success", value: source.preference }
      : { _tag: "Failure", cause: null },
}));
vi.mock("../state/managedPolicy", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePrimaryManagedPolicy: () =>
    source.policyOrganization === null
      ? undefined
      : {
          organization: source.policyOrganization,
          lockedSettings: [],
          limits: { telemetry: false },
        },
}));

const ENVIRONMENT_ID = EnvironmentId.make("primary");

const state = (
  name: string,
  preference: TelemetryPreference,
  policyOrganization: string | null = null,
): UiState => ({
  name,
  setup: () => {
    source.preference = preference;
    source.policyOrganization = policyOrganization;
    return () => {
      source.preference = { enabled: true, lockedBy: null };
      source.policyOrganization = null;
    };
  },
  render: () => <UsageDataSettingRow environmentId={ENVIRONMENT_ID} />,
  settle: async (cell) => {
    const control = cell.querySelector<HTMLElement>("[role='switch']");
    await expect.poll(() => control?.getAttribute("aria-checked")).toBe(String(preference.enabled));
    if (preference.lockedBy !== null) {
      await expect.poll(() => control?.hasAttribute("data-disabled")).toBe(true);
    }
  },
});

it("usage-data-setting", async () => {
  await captureUiStateSheet(
    "usage-data-setting",
    [
      {
        title: "Share anonymous usage data",
        states: [
          state("on", { enabled: true, lockedBy: null }),
          state("off", { enabled: false, lockedBy: null }),
          state("locked by the environment variable", { enabled: false, lockedBy: "environment" }),
          state(
            "locked by a managed policy",
            { enabled: false, lockedBy: "policy" },
            "Example Corp",
          ),
        ],
      },
    ],
    { cellWidth: 640 },
  );
});
