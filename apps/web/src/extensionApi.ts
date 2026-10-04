/**
 * Build-time web extension API for UpComputer product features. Features
 * define themselves with `defineExperimentalWebFeature`; the build's
 * `product/productEntry.ts` composes them.
 */
export * from "./product/FeatureRpc";
export * from "./product/WebFeature";
export * from "./product/WebProduct";
