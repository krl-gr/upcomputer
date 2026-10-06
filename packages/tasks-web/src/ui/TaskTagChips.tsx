import {
  Tooltip,
  TooltipPopup,
  TooltipTrigger,
} from "../../../../apps/web/src/components/ui/tooltip.tsx";
import { TablePill } from "./TablePill.tsx";

/** Tags shown as chips before the rest collapse into "+N". */
export const VISIBLE_TAG_CHIPS = 2;

export function splitTagChips(tags: ReadonlyArray<string>, limit = VISIBLE_TAG_CHIPS) {
  return { visible: tags.slice(0, limit), hidden: tags.length - Math.min(tags.length, limit) };
}

/**
 * A task's tags as table pills: the first ones, then "+N", with every tag in
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
            className="flex min-w-0"
            data-trigger-tag={props.triggerTags.has(tag) ? "" : undefined}
          >
            <TablePill
              tone={props.triggerTags.has(tag) ? "dim" : "neutral"}
              className="min-w-0 max-w-32 shrink justify-start"
            >
              <span className="truncate">{tag}</span>
            </TablePill>
          </span>
        ))}
        {hidden > 0 ? <TablePill>+{hidden}</TablePill> : null}
      </TooltipTrigger>
      <TooltipPopup>{props.tags.join(", ")}</TooltipPopup>
    </Tooltip>
  );
}
