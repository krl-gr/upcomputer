import type {
  ExperimentalWebFeatureContribution,
  ExperimentalWebThreadAccessoryProps,
} from "../product/WebFeature";
import { useWebProductComposition } from "../product/WebComposition";
import { useEnvironmentWebFeatureAvailability } from "../product/environmentProduct";

function Contribution({
  feature,
  ...props
}: ExperimentalWebThreadAccessoryProps & { feature: ExperimentalWebFeatureContribution }) {
  const contribution = feature.threadAccessory!;
  const availability = useEnvironmentWebFeatureAvailability(
    props.environmentId,
    feature,
    contribution.capabilities,
  );
  const Component = contribution.component;
  return availability.canLoad ? <Component {...props} /> : props.fallback;
}

/** Optional build-time extension; the sidebar row and chat header own placement and fallback. */
export function ThreadAccessory(props: ExperimentalWebThreadAccessoryProps) {
  const composition = useWebProductComposition();
  return composition.features.reduceRight(
    (fallback, feature) =>
      feature.threadAccessory ? (
        <Contribution key={feature.id} {...props} fallback={fallback} feature={feature} />
      ) : (
        fallback
      ),
    props.fallback,
  );
}
