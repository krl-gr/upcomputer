import { cn } from "../../../../apps/web/src/lib/utils.ts";

/**
 * An empty list's note, centered in the space the list would fill: a short title and an
 * optional hint. Every Tasks and Automations list uses it, so their zero states match.
 */
export function ListEmptyState(props: {
  readonly title: string;
  readonly hint?: string;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-1 px-6 py-10 text-center",
        props.className,
      )}
    >
      <p className="text-sm font-medium text-foreground">{props.title}</p>
      {props.hint ? (
        <p className="max-w-md text-sm text-balance text-muted-foreground">{props.hint}</p>
      ) : null}
    </div>
  );
}
