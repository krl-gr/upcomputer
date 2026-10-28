import { describeError, plainErrorSentence } from "@t3tools/client-runtime/errors";
import { Check, ChevronDown, ChevronUp, Copy } from "lucide";
import { createElement, useState, type ReactNode } from "react";

import { MorphIcon } from "~/components/MorphIcon";
import { Button } from "~/components/ui/button";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";

/**
 * The one place technical error text is shown: collapsed behind "Details",
 * with a copy button. Notices, toasts, banners and settings rows reuse it.
 */
export function ErrorDetails({ detail }: { readonly detail: string | null | undefined }) {
  const [open, setOpen] = useState(false);
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "error details" });
  const text = detail?.trim();
  if (!text) return null;
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-expanded={open}
          className="inline-flex cursor-pointer items-center gap-1 rounded-md py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => setOpen((value) => !value)}
        >
          <MorphIcon className="size-3.5 opacity-80" icon={open ? ChevronUp : ChevronDown} />
          {open ? "Hide details" : "Details"}
        </button>
        <Button
          size="icon-micro"
          variant="ghost-muted"
          aria-label={isCopied ? "Copied details" : "Copy details"}
          onClick={() => copyToClipboard(text, undefined)}
        >
          <MorphIcon icon={isCopied ? Check : Copy} />
        </Button>
      </div>
      {open ? (
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground select-text">
          {text}
        </pre>
      ) : null}
    </div>
  );
}

/** A plain sentence for a failed action, with the raw error behind Details. */
function ErrorDescription({
  error,
  action,
  message,
}: {
  readonly error: unknown;
  /** Reads after "Up.computer couldn't", e.g. "rename this thread". */
  readonly action?: string | undefined;
  /** Replaces the generated sentence when the caller knows better words. */
  readonly message?: string | undefined;
}) {
  const { detail } = describeError(error);
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <span>{message ?? plainErrorSentence(error, action)}</span>
      <ErrorDetails detail={detail} />
    </span>
  );
}

/** For toast descriptions built in `.ts` files that can't write JSX. */
export function errorToastDescription(error: unknown, action?: string): ReactNode {
  return createElement(ErrorDescription, { error, action });
}
