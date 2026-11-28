import { AppText as Text } from "../../components/ui/AppText";

/** A task's tag: a capsule tinted from the foreground, so it reads on any surface and theme. */
export function TaskTagChip(props: { readonly tag: string }) {
  return (
    <Text
      numberOfLines={1}
      className="overflow-hidden rounded-md bg-foreground/8 px-1.5 py-0.5 text-xs font-t3-medium text-foreground-secondary"
    >
      {props.tag}
    </Text>
  );
}
