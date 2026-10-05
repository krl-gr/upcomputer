import { composeExperimentalWebFeatures } from "../src/product/WebProduct";

/**
 * Stands in for `src/product/productEntry.ts` in unit tests (see
 * vite.config.ts): core alone with upstream's flags, so upstream's tests see
 * upstream behaviour. Tests for hidden features mock `product/productFlags`.
 */
export const WEB_PRODUCT = composeExperimentalWebFeatures([]);
