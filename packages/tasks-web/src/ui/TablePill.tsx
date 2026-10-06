import type { MouseEvent, ReactNode } from "react";

import { cn } from "../../../../apps/web/src/lib/utils.ts";

/**
 * Pill tones. `neutral` for labels such as tags, `dim` for agent trigger tags,
 * `status` for run counts: pass the run status text colour in `className` and
 * the pill tints its background from it.
 */
export type TablePillTone = "neutral" | "dim" | "status";

const BASE_CLASS =
  "inline-flex h-6 min-w-6 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-sm border border-transparent px-1.5 font-normal text-sm outline-none";
const BUTTON_CLASS =
  "cursor-pointer focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";
const TONE_CLASS: Record<TablePillTone, string> = {
  neutral: "bg-secondary text-secondary-foreground",
  dim: "bg-secondary text-secondary-foreground opacity-50",
  status: "bg-current/8 dark:bg-current/16",
};
const TONE_HOVER_CLASS: Record<TablePillTone, string> = {
  neutral: "hover:bg-secondary/90",
  dim: "hover:opacity-80",
  status: "hover:bg-current/16 dark:hover:bg-current/24",
};

/**
 * The one pill of the Tasks, Agents and Automations tables, for tags and run
 * counts alike: upstream Badge's shape and tokens at the rows' text size
 * (`text-sm`), so pills sit on one line with the text around them. With
 * `onClick` it renders a button.
 */
export function TablePill(props: {
  readonly tone?: TablePillTone;
  readonly className?: string | undefined;
  readonly title?: string;
  readonly onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  readonly children: ReactNode;
}) {
  const tone = props.tone ?? "neutral";
  if (props.onClick) {
    return (
      <button
        type="button"
        className={cn(
          BASE_CLASS,
          TONE_CLASS[tone],
          BUTTON_CLASS,
          TONE_HOVER_CLASS[tone],
          props.className,
        )}
        data-table-pill={tone}
        title={props.title}
        onClick={props.onClick}
      >
        {props.children}
      </button>
    );
  }
  return (
    <span
      className={cn(BASE_CLASS, TONE_CLASS[tone], props.className)}
      data-table-pill={tone}
      title={props.title}
    >
      {props.children}
    </span>
  );
}
