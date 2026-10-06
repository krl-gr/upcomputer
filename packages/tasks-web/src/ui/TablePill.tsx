import type { ReactNode } from "react";

import { cn } from "../../../../apps/web/src/lib/utils.ts";

/** Pill tones: `neutral` for labels such as tags, `dim` for agent trigger tags. */
export type TablePillTone = "neutral" | "dim";

const BASE_CLASS =
  "inline-flex h-6 min-w-6 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-sm border border-transparent px-1.5 font-normal text-sm outline-none";
const TONE_CLASS: Record<TablePillTone, string> = {
  neutral: "bg-secondary text-secondary-foreground",
  dim: "bg-secondary text-secondary-foreground opacity-50",
};

/**
 * The one pill of the Tasks, Agents and Automations tables, for tags and
 * labels: upstream Badge's shape and tokens at the rows' text size
 * (`text-sm`), so pills sit on one line with the text around them. Run counts
 * are not pills: they use the sidebar's `RunCountNumbers`.
 */
export function TablePill(props: {
  readonly tone?: TablePillTone;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}) {
  const tone = props.tone ?? "neutral";
  return (
    <span className={cn(BASE_CLASS, TONE_CLASS[tone], props.className)} data-table-pill={tone}>
      {props.children}
    </span>
  );
}
