import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { ArrowLeftIcon } from "lucide-react";
import { useState } from "react";

import { DialogPopup } from "../components/ui/dialog";
import { cn } from "../lib/utils";
import {
  type SurveyFormProps,
  SurveyAction,
  SurveyAnswerInput,
  SurveyError,
  SurveyFollowUps,
  SurveySendAction,
  SurveyThanksMark,
  USER_SURVEY_THANKS,
  USER_SURVEY_TITLE,
} from "./surveyParts";
import { canSubmitSurvey, type SurveyDraft, surveyAnswers, surveyBlocks } from "./userSurvey.logic";

// Long enough to see the chip turn before the next question comes in.
const AUTO_ADVANCE_MS = 260;

/** Direction C: one question at a time, with a progress bar and a slide between steps. */
export function UserSurveyStepsPopup({
  survey,
  draft,
  status,
  onDraftChange,
  onSubmit,
  onClose,
}: SurveyFormProps) {
  const [position, setPosition] = useState({ step: 0, back: false });
  const blocks = surveyBlocks(survey, draft);
  const sent = status.kind === "sent";
  const step = Math.min(position.step, blocks.length - 1);
  const block = blocks[step]!;
  const last = step === blocks.length - 1;
  const submitting = status.kind === "submitting";
  const answered = new Set(surveyAnswers(survey, draft).map((answer) => answer.questionId));
  const stepAnswered = [block.question, ...block.followUps].some((question) =>
    answered.has(question.id),
  );
  const canLeave = block.question.optional || answered.has(block.question.id);
  const go = (next: number) => setPosition({ step: next, back: next < step });

  const change = (next: SurveyDraft) => {
    onDraftChange(next);
    // A single choice that opens nothing under it is a full answer: move on.
    const question = block.question;
    if (last || question.type !== "single_choice" || question.hasOpenChoice) return;
    const picked = next[question.id]?.picked;
    if (picked === draft[question.id]?.picked) return;
    const opensFollowUp = surveyBlocks(survey, next)[step]!.followUps.length > 0;
    if (!opensFollowUp) setTimeout(() => go(step + 1), AUTO_ADVANCE_MS);
  };

  return (
    <DialogPopup className="sm:max-w-md" showCloseButton={!sent}>
      <form
        className="flex min-h-0 flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          if (sent || submitting) return;
          if (!last) {
            if (canLeave) go(step + 1);
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
        <div className="flex items-center gap-1 px-6 pt-6 pr-14" aria-hidden>
          {blocks.map((entry, index) => (
            <span key={entry.question.id} className="h-1 flex-1 rounded-full bg-foreground/10">
              <span
                className={cn(
                  "block h-full origin-left rounded-full bg-foreground transition-transform duration-300 ease-out motion-reduce:transition-none",
                  sent || index <= step ? "scale-x-100" : "scale-x-0",
                )}
              />
            </span>
          ))}
        </div>
        <div className="overflow-hidden">
          {sent ? (
            <div
              key="sent"
              className="flex min-h-60 flex-col items-center justify-center gap-1.5 px-6 pt-2 text-center"
            >
              <SurveyThanksMark />
              <p className="mt-2.5 text-xl leading-snug font-semibold tracking-tight">Thank you!</p>
              <p className="text-sm text-muted-foreground">{USER_SURVEY_THANKS}</p>
            </div>
          ) : (
            <fieldset
              key={step}
              disabled={submitting}
              className={cn(
                "flex min-h-60 min-w-0 translate-x-0 flex-col px-6 pt-5 pb-1 opacity-100 transition-[opacity,translate] duration-250 ease-out starting:opacity-0 motion-reduce:transition-none",
                position.back ? "starting:-translate-x-5" : "starting:translate-x-5",
              )}
            >
              <legend className="contents">
                <span className="text-xs text-muted-foreground tabular-nums">
                  {step + 1} of {blocks.length}
                  {block.question.optional ? " · optional" : ""}
                </span>
                <span className="mt-1.5 mb-4 text-xl leading-snug font-semibold tracking-tight">
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
          )}
        </div>
        <footer className="flex min-h-9 items-center gap-3 px-6 pt-3 pb-6">
          {sent ? (
            <div className="flex flex-1 justify-center">
              <SurveyAction size="lg" tone="soft" onClick={onClose}>
                Done
              </SurveyAction>
            </div>
          ) : (
            <>
              {step > 0 ? (
                <span className="-ml-2">
                  <SurveyAction
                    size="lg"
                    tone="quiet"
                    disabled={submitting}
                    onClick={() => go(step - 1)}
                  >
                    <ArrowLeftIcon aria-hidden />
                    Back
                  </SurveyAction>
                </span>
              ) : null}
              <span className="flex-1" />
              {last ? (
                <SurveySendAction
                  size="lg"
                  status={status}
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
