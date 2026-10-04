/**
 * Build-time server extension API for UpComputer product features.
 *
 * Features define contributions with these helpers and use the core services
 * re-exported below. An entry point composes its features with
 * `composeExperimentalServerFeatures` and passes the result to `runCli` in
 * `binCli.ts`. Keep this module light: feature packages import it, so it must
 * not pull in `server.ts` or the CLI.
 */
export * from "./product/FeatureMigrations.ts";
export * from "./product/HttpRouteContribution.ts";
export * from "./product/RpcContribution.ts";
export * from "./product/ServerProduct.ts";
export type { AnyProviderDriver, ProviderDriver } from "./provider/ProviderDriver.ts";
export type { BuiltInDriversEnv } from "./provider/builtInDrivers.ts";
export { McpInvocationContext } from "./mcp/McpInvocationContext.ts";
export { ProjectStoreV2 } from "./orchestration-v2/ProjectStore.ts";
export {
  isActiveRun,
  latestActiveRun,
  ThreadManagementService,
} from "./orchestration-v2/ThreadManagementService.ts";
export { ProviderRegistry } from "./provider/Services/ProviderRegistry.ts";
export { ServerSettingsService } from "./serverSettings.ts";
export { forkParked } from "./serverActivation.ts";
