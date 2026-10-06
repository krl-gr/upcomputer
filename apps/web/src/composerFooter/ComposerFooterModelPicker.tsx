import type { ComponentProps } from "react";

import { ProviderModelPicker } from "../components/chat/ProviderModelPicker";
import { productSurface } from "../product/productFlags";
import { composerModelPickerLabel } from "./composerFooterSurface";

/**
 * Upstream's model picker for the composer. With the UpComputer footer its
 * trigger reads "Provider · Model", as V1's did; a multi-model selection keeps
 * upstream's trigger.
 */
export function ComposerFooterModelPicker(props: ComponentProps<typeof ProviderModelPicker>) {
  const label =
    productSurface("composerFooter") === "upcomputer" && props.selectedModels === undefined
      ? composerModelPickerLabel(props)
      : null;
  return <ProviderModelPicker {...props} {...(label === null ? {} : { triggerLabel: label })} />;
}
