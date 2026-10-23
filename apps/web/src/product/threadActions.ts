import { WEB_PRODUCT } from "./productEntry";
import type { ExperimentalWebThreadAccessoryProps } from "./WebFeature";
import { collectExperimentalWebThreadActions } from "./WebProduct";

/** The product features' entries for a thread's action menu. */
export const productThreadActions = (thread: ExperimentalWebThreadAccessoryProps) =>
  collectExperimentalWebThreadActions(WEB_PRODUCT, thread);
