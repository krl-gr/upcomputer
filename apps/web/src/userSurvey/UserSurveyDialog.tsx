import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { ArrowLeftIcon, XIcon } from "lucide-react";
import { useRef } from "react";

import { Button } from "../components/ui/button";
import { Dialog, DialogPopup } from "../components/ui/dialog";
import { cn } from "../lib/utils";
import {
  type SurveyFormProps,
  SurveyAction,
  SurveyAnswerInput,
  SurveyAutoHeight,
  SurveyError,
  SurveyFollowUps,
  SurveySendAction,
  SurveyThanksMark,
  USER_SURVEY_THANKS,
  USER_SURVEY_TITLE,
} from "./surveyParts";
import { canSubmitSurvey, type SurveyDraft, surveyAnswers, surveySteps } from "./userSurvey.logic";

export type { SubmitUserSurvey, UserSurveyStatus } from "./surveyParts";

// Long enough to see the chip turn before the next question comes in.
const AUTO_ADVANCE_MS = 260;

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
  const formRef = useRef<HTMLFormElement>(null);
  const blocks = surveySteps(survey, draft);
  const sent = status.kind === "sent";
  const step = Math.min(askedStep, blocks.length - 1);
  const block = blocks[step]!;
  const last = step === blocks.length - 1;
  const submitting = status.kind === "submitting";
  const answered = new Set(surveyAnswers(survey, draft).map((answer) => answer.questionId));
  const stepAnswered = [block.question, ...block.followUps].some((question) =>
    answered.has(question.id),
  );
  const canLeave = block.question.optional || answered.has(block.question.id);

  const change = (next: SurveyDraft) => {
    onDraftChange(next);
    // A single choice that opens nothing under it is a full answer: move on.
    const question = block.question;
    if (last || question.type !== "single_choice" || question.hasOpenChoice) return;
    if (next[question.id]?.picked === draft[question.id]?.picked) return;
    const opensFollowUp = surveySteps(survey, next)[step]!.followUps.length > 0;
    if (!opensFollowUp) setTimeout(() => onStepChange(step + 1), AUTO_ADVANCE_MS);
  };

  return (
    <DialogPopup
      className="sm:max-w-md"
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
              <p className="mt-2.5 text-xl leading-snug font-semibold tracking-tight">Thank you!</p>
              <p className="text-sm text-muted-foreground">{USER_SURVEY_THANKS}</p>
            </div>
          ) : (
            <>
              <div className="mt-4 flex h-8 items-center justify-between pr-4 pl-6">
                <span className="text-xs text-muted-foreground tabular-nums">
                  {step + 1} of {blocks.length}
                </span>
                <DialogPrimitive.Close
                  aria-label="Close"
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
                  <span className="mb-4 text-xl leading-snug font-semibold tracking-tight text-balance">
                    {block.question.question}
                  </span>
                </legend>
                <SurveyAnswerInput
                  question={block.question}
                  draft={draft}
                  onDraftChange={change}
                  size="lg"
                  autoFocus={block.question.type === "open"}
                />
                <SurveyFollowUps
                  followUps={block.followUps}
                  draft={draft}
                  onDraftChange={onDraftChange}
                  size="lg"
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
                Done
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
                  Back
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
                  {stepAnswered || !block.question.optional ? "Continue" : "Skip"}
                </SurveyAction>
              )}
            </>
          )}
        </footer>
      </form>
    </DialogPopup>
  );
}
