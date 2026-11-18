import type { UserSurvey } from "@t3tools/contracts";
import { CircleQuestionMarkIcon } from "lucide-react";

import { SurveyAction, SurveyChip, USER_SURVEY_TITLE } from "./surveyParts";
import {
  EMPTY_DRAFT_ANSWER,
  pickChoice,
  type SurveyDraft,
  surveyCardQuestion,
} from "./userSurvey.logic";

/**
 * The survey's card in the notifications popover. It asks the first question
 * itself: a click on a chip is the answer, and the form opens for the rest.
 * A survey that does not start with a short single choice gets a Share chip.
 */
export function UserSurveyCard({
  survey,
  draft,
  onStart,
  onDismiss,
}: {
  readonly survey: UserSurvey;
  readonly draft: SurveyDraft;
  /** Opens the form with this draft: the card's pick, or the draft as it is. */
  readonly onStart: (draft: SurveyDraft) => void;
  readonly onDismiss: () => void;
}) {
  const question = surveyCardQuestion(survey);
  const answer = (question && draft[question.id]) || EMPTY_DRAFT_ANSWER;
  return (
    <li className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-start gap-x-2.5 rounded-lg bg-foreground/4 p-2.5">
      <span
        aria-hidden
        className="grid size-7 place-items-center rounded-lg bg-foreground/8 text-foreground [&_svg]:size-4"
      >
        <CircleQuestionMarkIcon />
      </span>
      <div className="flex min-w-0 flex-col gap-2">
        <p className="text-sm leading-4.5 font-medium text-balance">
          {question?.question ?? USER_SURVEY_TITLE}
        </p>
        <div className="flex flex-wrap items-center gap-1">
          {question ? (
            <div role="radiogroup" aria-label={question.question} className="contents">
              {question.choices.map((choice, index) => (
                <SurveyChip
                  key={choice}
                  size="sm"
                  multiple={false}
                  picked={answer.picked.includes(index)}
                  onClick={() =>
                    onStart({ ...draft, [question.id]: pickChoice(question, answer, index, true) })
                  }
                >
                  {choice}
                </SurveyChip>
              ))}
            </div>
          ) : (
            <SurveyAction size="sm" tone="soft" onClick={() => onStart(draft)}>
              Share
            </SurveyAction>
          )}
          <span className="-mr-1 ml-auto">
            <SurveyAction size="sm" tone="quiet" onClick={onDismiss}>
              No thanks
            </SurveyAction>
          </span>
        </div>
      </div>
    </li>
  );
}
