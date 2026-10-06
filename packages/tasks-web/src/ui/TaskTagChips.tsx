import { Badge } from "../../../../apps/web/src/components/ui/badge.tsx";
import {
  Tooltip,
  TooltipPopup,
  TooltipTrigger,
} from "../../../../apps/web/src/components/ui/tooltip.tsx";

/** Tags shown as chips before the rest collapse into "+N". */
export const VISIBLE_TAG_CHIPS = 2;

export function splitTagChips(tags: ReadonlyArray<string>, limit = VISIBLE_TAG_CHIPS) {
  return { visible: tags.slice(0, limit), hidden: tags.length - Math.min(tags.length, limit) };
}

/**
 * A task's tags as small chips: the first ones, then "+N", with every tag in
 * the tooltip. Agent trigger tags are dimmer than the task's own labels.
 */
export function TaskTagChips(props: {
  readonly tags: ReadonlyArray<string>;
  readonly triggerTags: ReadonlySet<string>;
}) {
  if (props.tags.length === 0) return null;
  const { visible, hidden } = splitTagChips(props.tags);
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className="flex min-w-0 max-w-full items-center gap-1 overflow-hidden" />}
      >
        {visible.map((tag) => (
          <span
            key={tag}
            className={`flex min-w-0 ${props.triggerTags.has(tag) ? "opacity-50" : ""}`}
            data-trigger-tag={props.triggerTags.has(tag) ? "" : undefined}
          >
            <Badge size="sm" variant="secondary" className="min-w-0 max-w-32 shrink justify-start">
              <span className="truncate">{tag}</span>
            </Badge>
          </span>
        ))}
        {hidden > 0 ? (
          <Badge size="sm" variant="secondary">
            +{hidden}
          </Badge>
        ) : null}
      </TooltipTrigger>
      <TooltipPopup>{props.tags.join(", ")}</TooltipPopup>
    </Tooltip>
  );
}
