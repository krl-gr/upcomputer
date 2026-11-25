import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { T, useGT, useMessages, Var } from "gt-react";
import { ArrowLeftIcon, XIcon } from "lucide-react";
import { useRef } from "react";

import { Button } from "../components/ui/button";
import { Dialog, DialogPopup } from "../components/ui/dialog";
import { cn } from "../lib/utils";
import { SendFeedbackHint } from "../sendFeedback/SendFeedbackHint";
import {
  type SurveyFormProps,
  SurveyAction,
  SurveyAnswerInput,
  SurveyAutoHeight,
  SurveyError,
  SurveySendAction,
  SurveyThanksMark,
  surveyThanks,
  USER_SURVEY_TITLE,
} from "./surveyParts";
import {
  canSubmitSurvey,
  surveyAnswers,
  surveyOpenedFollowUp,
  surveySteps,
} from "./userSurvey.logic";

export type { SubmitUserSurvey, UserSurveyStatus } from "./surveyParts";

/** Each sentence as a unit, so a two-sentence question breaks between them when it must wrap. */
function sentences(text: string) {
  return text.split(/(?<=[.?!])\s+/).map((sentence, index) => (
    // oxlint-disable-next-line react/no-array-index-key -- the parts of one fixed string
    <span key={index} className="inline-block">
      {sentence}
      {/* oxlint-disable-next-line t3code/no-untranslated-copy -- a space joining server-authored survey sentences */}
      &nbsp;
    </span>
  ));
}

/** The survey form: one question per step, in a centered dialog. The card asked the first. */
export function UserSurveyDialog({
  open,
  onOpenChange,
  onSent,
  ...form
}: Omit<SurveyFormProps, "onClose"> & {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The thank-you was closed: the survey is done. */
  readonly onSent: () => void;
}) {
  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next && form.status.kind === "sent") onSent();
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <UserSurveyDialogPopup {...form} onClose={() => close(false)} />
    </Dialog>
  );
}

/** The dialog's popup for a given draft, step and status; the UI states sheet draws each one. */
export function UserSurveyDialogPopup({
  survey,
  draft,
  status,
  step: askedStep,
  back,
  onDraftChange,
  onStepChange,
  onSubmit,
  onClose,
  onBackToCard,
}: SurveyFormProps) {
  const gt = useGT();
  const messages = useMessages();
  const formRef = useRef<HTMLFormElement>(null);
  const blocks = surveySteps(survey, draft);
  const sent = status.kind === "sent";
  const step = Math.min(askedStep, blocks.length - 1);
  const block = blocks[step]!;
  const last = step === blocks.length - 1;
  const submitting = status.kind === "submitting";
  const answered = new Set(surveyAnswers(survey, draft).map((answer) => answer.questionId));
  const stepAnswered = answered.has(block.question.id);
  const canLeave = block.question.optional || stepAnswered;
  const thanks = surveyThanks(surveyOpenedFollowUp(survey, draft), messages);

  return (
    <DialogPopup
      className="sm:max-w-lg"
      showCloseButton={false}
      // Opens with the caret in the step's text box: the card already took the first click.
      initialFocus={() => formRef.current?.querySelector<HTMLElement>("textarea, input") ?? true}
    >
      <form
        ref={formRef}
        className="flex min-h-0 flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          if (sent || submitting) return;
          if (!last) {
            if (canLeave) onStepChange(step + 1);
          } else if (canSubmitSurvey(survey, draft)) onSubmit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            event.currentTarget.requestSubmit();
          }
        }}
      >
        <DialogPrimitive.Title className="sr-only">{USER_SURVEY_TITLE}</DialogPrimitive.Title>
        {/* The header is inside, so the thank-you, which has none, arrives as one smooth resize. */}
        <SurveyAutoHeight>
          {sent ? (
            <div
              key="sent"
              className="flex flex-col items-center gap-1.5 px-6 pt-10 pb-5 text-center opacity-100 transition-opacity duration-300 ease-out starting:opacity-0 motion-reduce:transition-none"
            >
              <SurveyThanksMark />
              <p className="mt-2.5 text-xl leading-snug font-semibold tracking-tight">
                {thanks.title}
              </p>
              <p className="text-sm text-muted-foreground">{thanks.text}</p>
              <div className="mt-6 w-full">
                <SendFeedbackHint />
              </div>
            </div>
          ) : (
            <>
              <div className="mt-4 flex h-8 items-center justify-between pr-4 pl-6">
                <span className="text-xs text-muted-foreground tabular-nums">
                  <T>
                    <Var>{step + 1}</Var> of <Var>{blocks.length}</Var>
                  </T>
                </span>
                <DialogPrimitive.Close
                  aria-label={gt("Close", { $context: "button, closes the dialog" })}
                  render={<Button size="icon" variant="ghost" />}
                >
                  <XIcon />
                </DialogPrimitive.Close>
              </div>
              <div className="mt-1.5 flex items-center gap-1 px-6" aria-hidden>
                {blocks.map((entry, index) => (
                  <span
                    key={entry.question.id}
                    className="h-1 flex-1 rounded-full bg-foreground/10"
                  >
                    <span
                      className={cn(
                        "block h-full origin-left rounded-full bg-foreground transition-transform duration-300 ease-out motion-reduce:transition-none",
                        index <= step ? "scale-x-100" : "scale-x-0",
                      )}
                    />
                  </span>
                ))}
              </div>
              <fieldset
                key={step}
                disabled={submitting}
                className={cn(
                  "flex min-w-0 translate-x-0 flex-col px-6 pt-5 pb-1 opacity-100 transition-[opacity,translate] duration-250 ease-out starting:opacity-0 motion-reduce:transition-none",
                  back ? "starting:-translate-x-5" : "starting:translate-x-5",
                )}
              >
                <legend className="contents">
                  <span className="text-xl leading-snug font-semibold tracking-tight text-balance">
                    {sentences(block.question.question)}
                  </span>
                  {block.question.type === "multiple_choice" ? (
                    <span className="mt-1 text-sm text-muted-foreground">
                      <T>Pick as many as you like</T>
                    </span>
                  ) : null}
                  <span aria-hidden className="h-4" />
                </legend>
                <SurveyAnswerInput
                  question={block.question}
                  draft={draft}
                  onDraftChange={onDraftChange}
                  size="lg"
                  autoFocus={block.question.type === "open"}
                />
                {status.kind === "failed" ? (
                  <div className="flex pt-2.5">
                    <SurveyError status={status} />
                  </div>
                ) : null}
              </fieldset>
            </>
          )}
        </SurveyAutoHeight>
        <footer className="flex min-h-9 items-center gap-3 px-6 pt-4 pb-6">
          {sent ? (
            <div className="flex flex-1 justify-center">
              <SurveyAction size="lg" tone="soft" onClick={onClose}>
                <T>Done</T>
              </SurveyAction>
            </div>
          ) : (
            <>
              <span className="-ml-2">
                <SurveyAction
                  size="lg"
                  tone="quiet"
                  disabled={submitting}
                  onClick={() => (step > 0 ? onStepChange(step - 1) : onBackToCard())}
                >
                  <ArrowLeftIcon aria-hidden />
                  <T>Back</T>
                </SurveyAction>
              </span>
              <span className="flex-1" />
              {last ? (
                <SurveySendAction
                  size="lg"
                  status={status}
                  skip={!stepAnswered && block.question.optional}
                  disabled={!canSubmitSurvey(survey, draft)}
                />
              ) : (
                <SurveyAction
                  type="submit"
                  size="lg"
                  tone={stepAnswered || !block.question.optional ? "primary" : "soft"}
                  disabled={!canLeave}
                >
                  {stepAnswered || !block.question.optional
                    ? gt("Continue")
                    : gt("Skip", { $context: "button, skips an optional survey question" })}
                </SurveyAction>
              )}
            </>
          )}
        </footer>
      </form>
    </DialogPopup>
  );
}
