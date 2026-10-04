import { composeExperimentalWebFeatures } from "./WebProduct";

/**
 * The web product this build ships: core plus its web features. Another
 * product build replaces this module with its own composition.
 */
export const WEB_PRODUCT = composeExperimentalWebFeatures([]);
