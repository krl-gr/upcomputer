import { WEB_PRODUCT } from "./productEntry";
import type { ExperimentalWebThreadAccessoryProps } from "./WebFeature";
import { collectExperimentalWebThreadActions } from "./WebProduct";

export { runExperimentalWebThreadAction as runProductThreadAction } from "./WebProduct";

/** The product features' entries for a thread's action menu; `translate` is `useMessages()`. */
export const productThreadActions = (
  thread: ExperimentalWebThreadAccessoryProps,
  translate: (message: string) => string,
) => collectExperimentalWebThreadActions(WEB_PRODUCT, thread, translate);
