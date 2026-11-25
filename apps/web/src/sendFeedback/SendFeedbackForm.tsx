import { USER_FEEDBACK_MAX_LENGTH, type UserFeedbackSystemInfo } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { ArrowLeftIcon, CheckIcon, ChevronDownIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { Button, InlineButton } from "../components/ui/button";
import { PopoverTitle } from "../components/ui/popover";
import { cn } from "../lib/utils";
import {
  surveyFieldVariants,
  SurveyError,
  SurveySendAction,
  SurveyTextBox,
  SurveyThanksMark,
  type UserSurveyStatus,
} from "../userSurvey/surveyParts";
import { canSendFeedback, type FeedbackDraft, feedbackEmail } from "./sendFeedback.logic";

const THANKS_MS = 2200;

/** A checkbox row in the survey's look: the tick fills with the text colour, not blue. */
function FeedbackCheck({
  checked,
  onChange,
  label,
  track,
  children,
}: {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly label: string;
  readonly track: string;
  /** Sits under the label, in its column. */
  readonly children?: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-2">
      <label className="col-span-2 grid cursor-pointer grid-cols-subgrid items-start text-xs leading-4.5 select-none has-disabled:cursor-default">
        <span className="relative mt-px grid size-4 place-items-center">
          <input
            type="checkbox"
            data-track={track}
            className="peer absolute inset-0 cursor-pointer appearance-none rounded-sm bg-foreground/7 ring-1 ring-foreground/16 outline-none transition-[background-color,box-shadow] duration-150 ring-inset checked:bg-foreground checked:ring-transparent hover:bg-foreground/11 checked:hover:bg-foreground/85 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-64 motion-reduce:transition-none"
            checked={checked}
            onChange={(event) => onChange(event.target.checked)}
          />
          <CheckIcon
            aria-hidden
            strokeWidth={3}
            className="pointer-events-none relative size-3 scale-75 text-background opacity-0 transition-[opacity,scale] duration-150 ease-out peer-checked:scale-100 peer-checked:opacity-100 motion-reduce:transition-none"
          />
        </span>
        <span>{label}</span>
      </label>
      {children ? <div className="col-start-2 min-w-0">{children}</div> : null}
    </div>
  );
}

function IncludedInfo({ info }: { readonly info: UserFeedbackSystemInfo }) {
  const gt = useGT();
  const rows = [
    { label: gt("App version"), value: info.appVersion },
    { label: gt("System"), value: info.system ?? gt("Unknown") },
    {
      label: gt("Providers"),
      value: info.providers.length > 0 ? info.providers.join(", ") : gt("None connected"),
    },
  ];
  return (
    <div className="mt-1.5 rounded-lg bg-foreground/5 px-2.5 py-2 text-xs leading-4 opacity-100 transition-opacity duration-200 ease-out starting:opacity-0 motion-reduce:transition-none">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        {rows.map((row) => (
          <div key={row.label} className="col-span-2 grid grid-cols-subgrid">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="wrap-break-word">{row.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-1.5 text-muted-foreground">
        <T>Never your chats, files, paths or tokens.</T>
      </p>
    </div>
  );
}

/**
 * The feedback form, a page of the notifications popover: one text box, what
 * to include, and Send. Once sent it thanks and hands back to the list.
 */
export function SendFeedbackForm({
  draft,
  status,
  accountEmail,
  systemInfo,
  onDraftChange,
  onSubmit,
  onBack,
  onDone,
}: {
  readonly draft: FeedbackDraft;
  readonly status: UserSurveyStatus;
  readonly accountEmail: string | null;
  readonly systemInfo: UserFeedbackSystemInfo;
  readonly onDraftChange: (draft: FeedbackDraft) => void;
  readonly onSubmit: () => void;
  readonly onBack: () => void;
  /** The thank-you is over: back to the notifications. */
  readonly onDone: () => void;
}) {
  const gt = useGT();
  const [includedOpen, setIncludedOpen] = useState(false);
  const sent = status.kind === "sent";
  const submitting = status.kind === "submitting";

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the thank-you leaves by itself after a moment
  useEffect(() => {
    if (!sent) return;
    const timer = setTimeout(onDone, THANKS_MS);
    return () => clearTimeout(timer);
  }, [sent, onDone]);

  if (sent) {
    return (
      <div
        role="status"
        className="flex flex-col items-center gap-0.5 px-2 pt-7 pb-6 text-center opacity-100 transition-opacity duration-300 ease-out starting:opacity-0 motion-reduce:transition-none"
      >
        <SurveyThanksMark size="sm" />
        <p className="mt-2 text-sm font-medium">
          <T>Thanks, we got it.</T>
        </p>
        {draft.canEmail && feedbackEmail(draft, accountEmail).trim() ? (
          <p className="text-xs text-muted-foreground">
            <T>We'll email you if we have questions.</T>
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form
      className="flex translate-x-0 flex-col pb-1 opacity-100 transition-[opacity,translate] duration-200 ease-out starting:translate-x-3 starting:opacity-0 motion-reduce:transition-none"
      onSubmit={(event) => {
        event.preventDefault();
        if (!submitting && canSendFeedback(draft)) onSubmit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          event.currentTarget.requestSubmit();
        }
      }}
    >
      <div className="flex min-h-7 items-center gap-1.5 pb-2">
        <Button
          size="icon-micro"
          variant="ghost-muted"
          aria-label={gt("Back to notifications")}
          disabled={submitting}
          onClick={onBack}
        >
          <ArrowLeftIcon />
        </Button>
        <PopoverTitle className="flex-1">
          <T>Send feedback</T>
        </PopoverTitle>
      </div>
      <fieldset disabled={submitting} className="flex min-w-0 flex-col">
        <SurveyTextBox
          size="lg"
          lines={4}
          autoFocus
          maxLength={USER_FEEDBACK_MAX_LENGTH}
          aria-label={gt("Your feedback")}
          placeholder={gt("What happened, or what would you like to change?")}
          value={draft.text}
          onChange={(event) => onDraftChange({ ...draft, text: event.target.value })}
        />
        <div className="flex flex-col gap-2 px-1 pt-3">
          <FeedbackCheck
            track="feedback.include-system-info"
            checked={draft.includeSystemInfo}
            onChange={(includeSystemInfo) => onDraftChange({ ...draft, includeSystemInfo })}
            label={gt("Include app version and system info")}
          >
            <span className="flex text-xs leading-4.5">
              <InlineButton
                tone="muted"
                aria-expanded={includedOpen}
                onClick={() => setIncludedOpen(!includedOpen)}
              >
                <T>What's included</T>
                <ChevronDownIcon
                  aria-hidden
                  className={cn(
                    "size-3 transition-transform duration-150 ease-out motion-reduce:transition-none",
                    includedOpen && "rotate-180",
                  )}
                />
              </InlineButton>
            </span>
            {includedOpen ? <IncludedInfo info={systemInfo} /> : null}
          </FeedbackCheck>
          <FeedbackCheck
            track="feedback.can-email"
            checked={draft.canEmail}
            onChange={(canEmail) => onDraftChange({ ...draft, canEmail })}
            label={gt("You can email me about this")}
          >
            {draft.canEmail ? (
              <div className="pt-1.5 opacity-100 transition-opacity duration-200 ease-out starting:opacity-0 motion-reduce:transition-none">
                <input
                  type="email"
                  autoComplete="email"
                  autoCapitalize="off"
                  spellCheck={false}
                  className={surveyFieldVariants({ size: "sm" })}
                  aria-label={gt("Your email")}
                  placeholder={gt("you@example.com")}
                  // Signed in, the address is already there: the caret stays in the text box.
                  autoFocus={accountEmail === null && draft.email === null}
                  value={feedbackEmail(draft, accountEmail)}
                  onChange={(event) => onDraftChange({ ...draft, email: event.target.value })}
                />
              </div>
            ) : null}
          </FeedbackCheck>
        </div>
      </fieldset>
      <footer className="flex min-h-7 items-center gap-3 pt-3">
        <span className="flex min-w-0 flex-1 px-1">
          <SurveyError status={status} />
        </span>
        <SurveySendAction
          size="sm"
          status={status}
          skip={false}
          disabled={!canSendFeedback(draft)}
        />
      </footer>
    </form>
  );
}
