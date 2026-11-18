import type { UserSurvey, UserSurveyAnswer, UserSurveyQuestion } from "@t3tools/contracts";
import { CircleCheckIcon } from "lucide-react";
import { useId, useState } from "react";

import { APP_BASE_NAME } from "../branding";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Radio, RadioGroup } from "../components/ui/radio-group";
import { Spinner } from "../components/ui/spinner";
import { Textarea } from "../components/ui/textarea";
import {
  canSubmitSurvey,
  type ChoiceQuestion,
  EMPTY_DRAFT_ANSWER,
  isOpenChoice,
  pickChoice,
  type SurveyDraft,
  type SurveyDraftAnswer,
  surveyAnswers,
  surveyBlocks,
} from "./userSurvey.logic";

export const USER_SURVEY_TITLE = `How can we improve ${APP_BASE_NAME} for you?`;

export type UserSurveyStatus =
  | { readonly kind: "editing" }
  | { readonly kind: "submitting" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "sent" };

/** Sends the answers; resolves to an error message, or null once they are sent. */
export type SubmitUserSurvey = (answers: ReadonlyArray<UserSurveyAnswer>) => Promise<string | null>;

/** The survey form. The draft lives here, so closing and reopening keeps what was typed. */
export function UserSurveyDialog({
  survey,
  open,
  onOpenChange,
  onSubmit,
  onSent,
}: {
  readonly survey: UserSurvey;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: SubmitUserSurvey;
  /** The thank-you was closed: the survey is done. */
  readonly onSent: () => void;
}) {
  const [draft, setDraft] = useState<SurveyDraft>({});
  const [status, setStatus] = useState<UserSurveyStatus>({ kind: "editing" });
  const submit = () => {
    setStatus({ kind: "submitting" });
    void onSubmit(surveyAnswers(survey, draft)).then((message) =>
      setStatus(message === null ? { kind: "sent" } : { kind: "failed", message }),
    );
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next && status.kind === "sent") onSent();
      }}
    >
      <UserSurveyDialogPopup
        survey={survey}
        draft={draft}
        status={status}
        onDraftChange={setDraft}
        onSubmit={submit}
        onClose={() => {
          onOpenChange(false);
          if (status.kind === "sent") onSent();
        }}
      />
    </Dialog>
  );
}

/** The dialog's popup for a given draft and status; the UI states sheet draws each one. */
export function UserSurveyDialogPopup({
  survey,
  draft,
  status,
  onDraftChange,
  onSubmit,
  onClose,
}: {
  readonly survey: UserSurvey;
  readonly draft: SurveyDraft;
  readonly status: UserSurveyStatus;
  readonly onDraftChange: (draft: SurveyDraft) => void;
  readonly onSubmit: () => void;
  readonly onClose: () => void;
}) {
  if (status.kind === "sent") {
    return (
      <DialogPopup className="sm:max-w-md" showCloseButton={false}>
        <DialogPanel>
          <div className="flex flex-col items-center gap-2 pt-2 text-center">
            <CircleCheckIcon aria-hidden className="size-8 text-success-foreground" />
            <DialogTitle>Thank you!</DialogTitle>
            <DialogDescription>Your answers help us decide what to build next.</DialogDescription>
          </div>
        </DialogPanel>
        <DialogFooter variant="bare" className="sm:justify-center">
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogPopup>
    );
  }
  const submitting = status.kind === "submitting";
  const update = (questionId: string, answer: SurveyDraftAnswer) =>
    onDraftChange({ ...draft, [questionId]: answer });
  return (
    <DialogPopup className="sm:max-w-lg">
      <form
        className="contents"
        onSubmit={(event) => {
          event.preventDefault();
          if (!submitting && canSubmitSurvey(survey, draft)) onSubmit();
        }}
      >
        <DialogHeader>
          <DialogTitle>{USER_SURVEY_TITLE}</DialogTitle>
          <DialogDescription>
            Your answers go straight to the {APP_BASE_NAME} team.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-6">
            {surveyBlocks(survey, draft).map(({ question, followUps }) => (
              <fieldset key={question.id} disabled={submitting} className="flex flex-col gap-2.5">
                <QuestionLabel question={question} />
                <QuestionInput
                  question={question}
                  answer={draft[question.id] ?? EMPTY_DRAFT_ANSWER}
                  onChange={(answer) => update(question.id, answer)}
                />
                {followUps.map((followUp) => (
                  <div key={followUp.id} className="flex flex-col gap-1.5 pl-6.5 sm:pl-6">
                    <QuestionLabel question={followUp} followUp />
                    <QuestionInput
                      question={followUp}
                      answer={draft[followUp.id] ?? EMPTY_DRAFT_ANSWER}
                      onChange={(answer) => update(followUp.id, answer)}
                      followUp
                    />
                  </div>
                ))}
              </fieldset>
            ))}
          </div>
        </DialogPanel>
        <DialogFooter className="sm:items-center">
          {status.kind === "failed" ? (
            <p role="alert" className="text-destructive-foreground text-sm sm:mr-auto">
              {status.message}
            </p>
          ) : null}
          <Button type="submit" disabled={submitting || !canSubmitSurvey(survey, draft)}>
            {submitting ? <Spinner /> : null}
            {submitting ? "Sending…" : "Submit"}
          </Button>
        </DialogFooter>
      </form>
    </DialogPopup>
  );
}

function QuestionLabel({
  question,
  followUp = false,
}: {
  readonly question: UserSurveyQuestion;
  readonly followUp?: boolean;
}) {
  return (
    <legend className="contents">
      <span className={followUp ? "text-xs text-muted-foreground" : "text-sm font-medium"}>
        {question.question}
      </span>
      {question.description ? (
        <span className="text-xs text-muted-foreground">{question.description}</span>
      ) : null}
    </legend>
  );
}

function QuestionInput({
  question,
  answer,
  onChange,
  followUp = false,
}: {
  readonly question: UserSurveyQuestion;
  readonly answer: SurveyDraftAnswer;
  readonly onChange: (answer: SurveyDraftAnswer) => void;
  readonly followUp?: boolean;
}) {
  if (question.type === "open") {
    return followUp ? (
      <Input
        aria-label={question.question}
        value={answer.text}
        onChange={(event) => onChange({ ...answer, text: event.target.value })}
      />
    ) : (
      <Textarea
        aria-label={question.question}
        rows={3}
        value={answer.text}
        onChange={(event) => onChange({ ...answer, text: event.target.value })}
      />
    );
  }
  return <ChoiceInput question={question} answer={answer} onChange={onChange} />;
}

function ChoiceInput({
  question,
  answer,
  onChange,
}: {
  readonly question: ChoiceQuestion;
  readonly answer: SurveyDraftAnswer;
  readonly onChange: (answer: SurveyDraftAnswer) => void;
}) {
  const id = useId();
  const openPicked = question.choices.some(
    (_, index) => isOpenChoice(question, index) && answer.picked.includes(index),
  );
  const otherInput = openPicked ? (
    <div className="pl-6.5 sm:pl-6">
      <Input
        aria-label={question.choices.at(-1)}
        placeholder="Your answer"
        autoFocus
        value={answer.otherText}
        onChange={(event) => onChange({ ...answer, otherText: event.target.value })}
      />
    </div>
  ) : null;
  const optionClass = "flex cursor-pointer items-center gap-2 text-sm";
  if (question.type === "single_choice") {
    return (
      <>
        <RadioGroup
          aria-label={question.question}
          value={answer.picked[0] === undefined ? null : String(answer.picked[0])}
          onValueChange={(value) => onChange(pickChoice(question, answer, Number(value), true))}
        >
          {question.choices.map((choice, index) => (
            <label key={choice} htmlFor={`${id}-${index}`} className={optionClass}>
              <Radio id={`${id}-${index}`} value={String(index)} />
              {choice}
            </label>
          ))}
        </RadioGroup>
        {otherInput}
      </>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {question.choices.map((choice, index) => (
        <label key={choice} className={optionClass}>
          <Checkbox
            checked={answer.picked.includes(index)}
            onCheckedChange={(checked) => onChange(pickChoice(question, answer, index, checked))}
          />
          {choice}
        </label>
      ))}
      {otherInput}
    </div>
  );
}
