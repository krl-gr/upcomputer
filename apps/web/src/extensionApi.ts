/**
 * Build-time web extension API for UpComputer product features. Features
 * define themselves with `defineExperimentalWebFeature`; the build's
 * `product/productEntry.ts` composes them.
 */
export * from "./product/FeatureRpc";
export * from "./product/WebFeature";
export * from "./product/WebProduct";
export {
  UPCOMPUTER_PRODUCT_FLAGS,
  UPSTREAM_PRODUCT_FLAGS,
  type ProductFlags,
} from "@t3tools/shared/productFlags";
