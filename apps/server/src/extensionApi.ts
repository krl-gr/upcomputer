/**
 * Experimental public build-time server product API.
 *
 * This B3 boundary exposes product composition, server CLI assembly, feature
 * runtime layers, feature migrations, feature interaction modes, HTTP routes,
 * dynamic tools, server-side preview automation hosts, tools on the core MCP
 * server, and selected service tags needed by first-party private products.
 */
export * from "./product/DynamicToolRegistry.ts";
export * from "./product/FeatureMigrations.ts";
export * from "./product/HttpRouteContribution.ts";
export * from "./product/InteractionModeRegistryService.ts";
export * from "./product/McpToolContribution.ts";
export * from "./product/PreviewAutomationHostContribution.ts";
export * from "./product/ProviderRuntimeEvents.ts";
export * from "./product/RpcContribution.ts";
export * from "./product/ServerProductComposition.ts";
export * from "./product/ServerProductEntry.ts";
export * from "./product/ProductServerCli.ts";
export {
  defaultProviderContinuationIdentity,
  type AnyProviderDriver,
  type ProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderDriverCreateInput,
  type ProviderDriverMetadata,
  type ProviderInstance,
} from "./provider/ProviderDriver.ts";
export { CORE_SERVER_PRODUCT_ENTRY } from "./product/defaultProductEntry.ts";
export { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine.ts";
export { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery.ts";
export { ProviderRegistry } from "./provider/Services/ProviderRegistry.ts";
export { ServerSettingsService } from "./serverSettings.ts";
export {
  makeRoutesLayerForProduct,
  makeServerLayerForProduct,
  runServerForProduct,
} from "./server.ts";
