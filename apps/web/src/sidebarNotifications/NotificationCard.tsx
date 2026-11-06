import { cva, type VariantProps } from "class-variance-authority";
import { CheckIcon, CopyIcon, XIcon } from "lucide-react";
import { type ComponentProps, type ReactNode, useState } from "react";

import { Button, InlineButton } from "../components/ui/button";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { cn } from "../lib/utils";

const notificationButtonVariants = cva(
  "inline-flex h-6 shrink-0 cursor-pointer items-center justify-center gap-1 rounded-md px-2.5 text-xs font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-64",
  {
    variants: {
      tone: {
        // Inverts the theme: white on dark, black on light.
        primary: "bg-foreground text-background hover:bg-foreground/85",
        // The selected sidebar row's tone, darkened enough to show on a light popover.
        secondary: "bg-foreground/8 text-foreground hover:bg-foreground/13",
      },
    },
  },
);

/** The popover's action button; Button's variants are outlined or blue. */
export function NotificationButton({
  tone,
  ...props
}: Omit<ComponentProps<"button">, "className"> &
  Required<VariantProps<typeof notificationButtonVariants>>) {
  return <button type="button" className={notificationButtonVariants({ tone })} {...props} />;
}

export type NotificationTileTone = "error" | "warning" | "info" | "neutral";

const TILE_CLASS: Record<NotificationTileTone, string> = {
  error: "bg-destructive/12 text-destructive",
  warning: "bg-warning/14 text-warning-foreground",
  info: "bg-info/14 text-info-foreground",
  neutral: "bg-foreground/8 text-foreground",
};

/**
 * One notification: a tinted icon tile, a title with an optional time, a
 * detail line and the main action on the right. Links, Details and the
 * expanded details run full width below.
 */
export function NotificationCard({
  tone,
  icon,
  title,
  time,
  detail,
  action,
  links,
  details,
  below,
  onDismiss,
}: {
  readonly tone: NotificationTileTone;
  readonly icon: ReactNode;
  readonly title: string;
  readonly time?: { readonly label: string; readonly dateTime: string } | undefined;
  readonly detail: string;
  readonly action?: ReactNode;
  readonly links?: ReactNode;
  /** Technical text behind a "Details" link. */
  readonly details?: string | null | undefined;
  readonly below?: ReactNode;
  readonly onDismiss?: (() => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "error details" });
  const detailText = details?.trim() || null;
  return (
    <li className="relative grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-start gap-x-2.5 gap-y-0.5 rounded-lg bg-foreground/4 p-2.5">
      <span
        aria-hidden
        className={cn(
          "row-span-2 grid size-7 place-items-center rounded-lg [&_svg]:size-4",
          TILE_CLASS[tone],
        )}
      >
        {icon}
      </span>
      <p className={cn("text-sm leading-4.5 font-medium", onDismiss && "pr-4")}>
        {title}
        {time ? (
          <time
            dateTime={time.dateTime}
            className="ml-1.5 text-2xs font-normal text-muted-foreground"
          >
            {time.label}
          </time>
        ) : null}
      </p>
      {action ? (
        <div className="col-start-3 row-span-2 row-start-1 flex items-center gap-1.5 self-center">
          {action}
        </div>
      ) : null}
      <p className="col-start-2 text-xs leading-4 wrap-break-word text-muted-foreground">
        {detail}
      </p>
      {below ? <div className="col-span-2 col-start-2 mt-1.5">{below}</div> : null}
      {links || detailText ? (
        <div className="col-span-2 col-start-2 mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {links}
          {detailText ? (
            <InlineButton tone="muted" aria-expanded={open} onClick={() => setOpen(!open)}>
              {open ? "Hide details" : "Details"}
            </InlineButton>
          ) : null}
          {detailText && open ? (
            <Button
              size="icon-micro"
              variant="ghost-muted"
              aria-label={isCopied ? "Copied details" : "Copy details"}
              onClick={() => copyToClipboard(detailText, undefined)}
            >
              {isCopied ? <CheckIcon /> : <CopyIcon />}
            </Button>
          ) : null}
        </div>
      ) : null}
      {detailText && open ? (
        <pre className="col-span-full mt-1.5 max-h-40 overflow-auto rounded-md bg-foreground/5 p-2 font-mono text-2xs leading-3.75 whitespace-pre-wrap break-words text-muted-foreground select-text">
          {detailText}
        </pre>
      ) : null}
      {onDismiss ? (
        <span className="absolute top-1.5 right-1.5">
          <Button size="icon-micro" variant="ghost-muted" aria-label="Dismiss" onClick={onDismiss}>
            <XIcon />
          </Button>
        </span>
      ) : null}
    </li>
  );
}

export function NotificationProgress({ percent }: { readonly percent: number | null }) {
  const width = percent === null || !Number.isFinite(percent) ? 0 : Math.min(100, percent);
  return (
    <div className="h-[3px] overflow-hidden rounded-full bg-foreground/14">
      <div
        className="h-full rounded-full bg-foreground/75 transition-[width] duration-300 ease-out motion-reduce:transition-none"
        style={{ width: `${Math.max(0, width)}%` }}
      />
    </div>
  );
}
