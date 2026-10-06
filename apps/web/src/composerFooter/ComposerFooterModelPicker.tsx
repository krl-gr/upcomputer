import type { ComponentProps } from "react";

import { ProviderModelPicker } from "../components/chat/ProviderModelPicker";
import { productSurface } from "../product/productFlags";
import { cn } from "../lib/utils";
import { composerModelPickerLabel } from "./composerFooterSurface";
import { COMPOSER_MODEL_PICKER_TRIGGER_CLASS } from "./composerLookStyles";

/**
 * Upstream's model picker for the composer. With the UpComputer footer its
 * trigger reads "Provider · Model" in V1's text style, as V1's did; a
 * multi-model selection keeps upstream's label. Upstream's composer pulls the
 * picker to its row's edge (`-ms-2.5`); in our row a separator comes first,
 * so the margin goes and the separator keeps its gap.
 */
export function ComposerFooterModelPicker(props: ComponentProps<typeof ProviderModelPicker>) {
  if (productSurface("composerFooter") !== "upcomputer") return <ProviderModelPicker {...props} />;
  const label = props.selectedModels === undefined ? composerModelPickerLabel(props) : null;
  return (
    <ProviderModelPicker
      {...props}
      {...(label === null ? {} : { triggerLabel: label })}
      triggerClassName={cn(COMPOSER_MODEL_PICKER_TRIGGER_CLASS, props.triggerClassName, "ms-0")}
    />
  );
}
