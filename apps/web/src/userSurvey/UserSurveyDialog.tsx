import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";

import { Dialog, DialogPopup } from "../components/ui/dialog";
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
  surveyLengthLabel,
} from "./surveyParts";
import { UserSurveyStepsPopup } from "./UserSurveySteps";
import { canSubmitSurvey, surveyBlocks } from "./userSurvey.logic";

export { type SubmitUserSurvey, type UserSurveyStatus } from "./surveyParts";

/** The survey in a centered dialog: every question on one sheet, or one per step. */
export function UserSurveyDialog({
  steps,
  open,
  onOpenChange,
  onSent,
  ...form
}: Omit<SurveyFormProps, "onClose"> & {
  readonly steps: boolean;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The thank-you was closed: the survey is done. */
  readonly onSent: () => void;
}) {
  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next && form.status.kind === "sent") onSent();
  };
  const Popup = steps ? UserSurveyStepsPopup : UserSurveyDialogPopup;
  return (
    <Dialog open={open} onOpenChange={close}>
      <Popup {...form} onClose={() => close(false)} />
    </Dialog>
  );
}

/** Direction A: one sheet, chips for every choice. */
export function UserSurveyDialogPopup({
  survey,
  draft,
  status,
  onDraftChange,
  onSubmit,
  onClose,
}: SurveyFormProps) {
  if (status.kind === "sent") {
    return (
      <DialogPopup className="sm:max-w-sm" showCloseButton={false}>
        <div className="flex flex-col items-center gap-1.5 px-6 pt-9 pb-6 text-center">
          <SurveyThanksMark />
          <DialogPrimitive.Title className="mt-2.5 text-lg leading-snug font-semibold">
            Thank you!
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="text-sm text-muted-foreground">
            {USER_SURVEY_THANKS}
          </DialogPrimitive.Description>
          <div className="mt-4">
            <SurveyAction size="md" tone="soft" onClick={onClose}>
              Done
            </SurveyAction>
          </div>
        </div>
      </DialogPopup>
    );
  }
  const submitting = status.kind === "submitting";
  return (
    <DialogPopup className="sm:max-w-120">
      <form
        className="flex min-h-0 flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          if (!submitting && canSubmitSurvey(survey, draft)) onSubmit();
        }}
      >
        <header className="flex flex-col gap-1 px-6 pt-6 pr-12">
          <DialogPrimitive.Title className="text-lg leading-snug font-semibold tracking-tight">
            {USER_SURVEY_TITLE}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="text-sm text-muted-foreground">
            {surveyLengthLabel(survey)}
          </DialogPrimitive.Description>
        </header>
        <div className="flex min-h-0 flex-col gap-6 overflow-y-auto px-6 pt-6 pb-2">
          {surveyBlocks(survey, draft).map(({ question, followUps }) => (
            <fieldset key={question.id} disabled={submitting} className="flex min-w-0 flex-col">
              <legend className="mb-2.5 flex w-full items-baseline gap-2 text-sm font-semibold">
                {question.question}
                {question.type === "multiple_choice" ? (
                  <span className="text-xs font-normal text-muted-foreground">
                    Pick any that fit
                  </span>
                ) : null}
              </legend>
              <SurveyAnswerInput
                question={question}
                draft={draft}
                onDraftChange={onDraftChange}
                size="md"
              />
              <SurveyFollowUps
                followUps={followUps}
                draft={draft}
                onDraftChange={onDraftChange}
                size="md"
              />
            </fieldset>
          ))}
        </div>
        <footer className="flex items-center justify-end gap-3 px-6 pt-4 pb-6">
          {status.kind === "failed" ? (
            <SurveyError status={status} />
          ) : (
            <p className="min-w-0 flex-1 text-xs text-muted-foreground">
              Goes straight to the team.
            </p>
          )}
          <SurveySendAction size="md" status={status} disabled={!canSubmitSurvey(survey, draft)} />
        </footer>
      </form>
    </DialogPopup>
  );
}
