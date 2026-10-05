import { AuthOrchestrationOperateScope, AuthOrchestrationReadScope } from "@t3tools/contracts";
import {
  COMPUTER_USE_RPC_METHODS,
  COMPUTER_USE_RPC_NAMESPACE,
  ComputerUseRpcError,
  ComputerUseRpcGroup,
  type ComputerUseSettingsInput,
  type ComputerUseStateSnapshot,
} from "@t3tools/computer-use-contracts/rpc";
import * as Effect from "effect/Effect";

import { ServerConfig } from "../../../../apps/server/src/config.ts";
import { defineNamespacedRpcContribution } from "../../../../apps/server/src/extensionApi.ts";
import {
  BrowserAutomationService,
  type BrowserAutomationServiceShape,
} from "../browser/BrowserAutomationService.ts";
import { readBrowserUseSettings } from "../browser/BrowserUseSettings.ts";
import {
  ComputerUseService,
  type ComputerUseServiceShape,
} from "../computerUse/ComputerUseService.ts";
import { updateSettingsSection } from "../settings/ComputerUseSettingsFile.ts";

interface RuntimeServices {
  readonly browser: BrowserAutomationServiceShape;
  readonly computerUse: ComputerUseServiceShape;
  readonly settingsPath: string;
}

const runtimeServices = Effect.gen(function* () {
  return {
    browser: yield* BrowserAutomationService,
    computerUse: yield* ComputerUseService,
    settingsPath: (yield* ServerConfig).settingsPath,
  } satisfies RuntimeServices;
});

function messageFromDoctor(stdout: string, stderr: string): string | undefined {
  const message = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n").slice(0, 2_000);
  return message || undefined;
}

async function snapshotFor(services: RuntimeServices): Promise<ComputerUseStateSnapshot> {
  const [browser, browserUse, computerUse] = await Promise.all([
    services.browser.snapshot(),
    readBrowserUseSettings(services.settingsPath),
    services.computerUse.snapshot(),
  ]);
  return {
    browser: {
      status: browser.status,
      alwaysUseChrome: browserUse.alwaysUseChrome,
      profilePath: browser.profilePath,
      ...(browser.browserName ? { browserName: browser.browserName } : {}),
      ...(browser.currentUrl ? { currentUrl: browser.currentUrl } : {}),
      ...(browser.currentTitle ? { currentTitle: browser.currentTitle } : {}),
    },
    computerUse: {
      status: computerUse.status,
      managed: true,
      command: computerUse.command,
      args: computerUse.args,
      mode: computerUse.settings.mode,
      actionApproval: computerUse.settings.requireActionApproval,
      settings: computerUse.settings,
      tools: computerUse.tools,
      missingRequiredTools: computerUse.missingRequiredTools,
      ...(computerUse.lastError ? { lastError: computerUse.lastError } : {}),
      ...(computerUse.doctor
        ? {
            doctorStatus: computerUse.doctor.status,
            checkedAt: computerUse.doctor.checkedAt,
            ...(messageFromDoctor(computerUse.doctor.stdout, computerUse.doctor.stderr)
              ? {
                  doctorMessage: messageFromDoctor(
                    computerUse.doctor.stdout,
                    computerUse.doctor.stderr,
                  ),
                }
              : {}),
          }
        : {}),
    },
  };
}

function normalizeComputerUseSettings(
  settings: ComputerUseSettingsInput,
): ComputerUseSettingsInput {
  const binaryPath = settings.binaryPath.trim();
  if (!binaryPath) throw new Error("Computer Use backend command is required.");
  return {
    ...settings,
    binaryPath,
    mcpArgs: settings.mcpArgs.map((arg) => arg.trim()).filter(Boolean),
    allowedApps: [...new Set(settings.allowedApps.map((app) => app.trim()).filter(Boolean))],
  };
}

const rpcError = (cause: unknown) =>
  new ComputerUseRpcError({
    message: cause instanceof Error ? cause.message : String(cause),
  });

function runtimeAction(action: (services: RuntimeServices) => Promise<unknown>) {
  return Effect.gen(function* () {
    const services = yield* runtimeServices;
    yield* Effect.tryPromise({ try: () => action(services), catch: rpcError });
    return yield* Effect.tryPromise({ try: () => snapshotFor(services), catch: rpcError });
  });
}

export const COMPUTER_USE_RPC_CONTRIBUTION = defineNamespacedRpcContribution({
  id: "computer-use-rpc-v1",
  ownerId: "upcomputer.computer-use",
  version: 1,
  namespace: COMPUTER_USE_RPC_NAMESPACE,
  group: ComputerUseRpcGroup,
  // Reading the state is a read; everything that starts, stops or saves operates.
  requiredScopes: {
    [COMPUTER_USE_RPC_METHODS.snapshot]: AuthOrchestrationReadScope,
    [COMPUTER_USE_RPC_METHODS.openBrowser]: AuthOrchestrationOperateScope,
    [COMPUTER_USE_RPC_METHODS.closeBrowser]: AuthOrchestrationOperateScope,
    [COMPUTER_USE_RPC_METHODS.clearBrowserProfile]: AuthOrchestrationOperateScope,
    [COMPUTER_USE_RPC_METHODS.updateBrowserSettings]: AuthOrchestrationOperateScope,
    [COMPUTER_USE_RPC_METHODS.startComputerUse]: AuthOrchestrationOperateScope,
    [COMPUTER_USE_RPC_METHODS.stopComputerUse]: AuthOrchestrationOperateScope,
    [COMPUTER_USE_RPC_METHODS.doctorComputerUse]: AuthOrchestrationOperateScope,
    [COMPUTER_USE_RPC_METHODS.refreshComputerUseTools]: AuthOrchestrationOperateScope,
    [COMPUTER_USE_RPC_METHODS.updateComputerUseSettings]: AuthOrchestrationOperateScope,
  },
  handlers: () =>
    ComputerUseRpcGroup.toLayer(
      ComputerUseRpcGroup.of({
        [COMPUTER_USE_RPC_METHODS.snapshot]: () => runtimeAction(async () => undefined),
        [COMPUTER_USE_RPC_METHODS.openBrowser]: ({ url }) =>
          runtimeAction((services) =>
            services.browser.openLoginWindow(url === undefined ? {} : { url }),
          ),
        [COMPUTER_USE_RPC_METHODS.closeBrowser]: () =>
          runtimeAction((services) => services.browser.closeBrowser()),
        [COMPUTER_USE_RPC_METHODS.clearBrowserProfile]: () =>
          runtimeAction((services) => services.browser.clearProfileData()),
        [COMPUTER_USE_RPC_METHODS.updateBrowserSettings]: ({ alwaysUseChrome }) =>
          runtimeAction(async (services) => {
            await updateSettingsSection(services.settingsPath, "browser", { alwaysUseChrome });
          }),
        [COMPUTER_USE_RPC_METHODS.startComputerUse]: () =>
          runtimeAction((services) => services.computerUse.restart()),
        [COMPUTER_USE_RPC_METHODS.stopComputerUse]: () =>
          runtimeAction((services) => services.computerUse.stop()),
        [COMPUTER_USE_RPC_METHODS.doctorComputerUse]: () =>
          runtimeAction((services) => services.computerUse.doctor()),
        [COMPUTER_USE_RPC_METHODS.refreshComputerUseTools]: () =>
          runtimeAction((services) => services.computerUse.refreshTools()),
        [COMPUTER_USE_RPC_METHODS.updateComputerUseSettings]: ({ settings }) =>
          runtimeAction(async (services) => {
            const normalizedSettings = normalizeComputerUseSettings(settings);
            await updateSettingsSection(services.settingsPath, "computerUse", normalizedSettings);
            if (!normalizedSettings.enabled) await services.computerUse.stop();
          }),
      }),
    ),
});
