import type { UserSurvey } from "@t3tools/contracts";
import { CircleQuestionMarkIcon, XIcon } from "lucide-react";

import { Button } from "../components/ui/button";
import { SurveyChip } from "./surveyParts";
import {
  EMPTY_DRAFT_ANSWER,
  pickChoice,
  type SurveyDraft,
  surveyCardQuestion,
} from "./userSurvey.logic";

const EMOJI = /(\p{Extended_Pictographic}️?)/u;

/** An emoji's glyph carries its own trailing room, which doubles the space after it. */
function tightenEmoji(text: string) {
  return text.split(EMOJI).map((part, index) =>
    EMOJI.test(part) ? (
      // oxlint-disable-next-line react/no-array-index-key -- the parts of one fixed string
      <span key={index} className="-mr-0.5">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/**
 * The survey's card in the notifications popover. It asks the first question
 * itself: a click on a chip is the answer, and the form opens for the rest.
 * The survey starts with a short single choice; without one there is no card.
 */
export function UserSurveyCard({
  survey,
  draft,
  onStart,
  onDismiss,
}: {
  readonly survey: UserSurvey;
  readonly draft: SurveyDraft;
  /** Opens the form with the card's pick in the draft. */
  readonly onStart: (draft: SurveyDraft) => void;
  readonly onDismiss: () => void;
}) {
  const question = surveyCardQuestion(survey);
  if (!question) return null;
  const answer = draft[question.id] ?? EMPTY_DRAFT_ANSWER;
  return (
    <li className="relative grid grid-cols-[1.75rem_minmax(0,1fr)] items-start gap-x-2.5 rounded-lg bg-foreground/4 p-2.5">
      <span
        aria-hidden
        className="grid size-7 place-items-center rounded-lg bg-foreground/8 text-foreground [&_svg]:size-4"
      >
        <CircleQuestionMarkIcon />
      </span>
      <div className="flex min-w-0 flex-col gap-2">
        <p className="pr-5 text-sm leading-4.5 font-medium text-balance">
          {tightenEmoji(question.question)}
        </p>
        {/* Above the dismiss button, whose touch target is larger than its glyph. */}
        <div className="relative z-1 flex flex-wrap items-center gap-1">
          <div role="radiogroup" aria-label={question.question} className="contents">
            {question.choices.map((choice, index) => (
              <SurveyChip
                key={choice.label}
                size="sm"
                multiple={false}
                picked={answer.picked.includes(index)}
                onClick={() =>
                  onStart({ ...draft, [question.id]: pickChoice(question, answer, index, true) })
                }
              >
                {choice.label}
              </SurveyChip>
            ))}
          </div>
        </div>
      </div>
      <span className="absolute top-1.5 right-1.5">
        <Button size="icon-micro" variant="ghost-muted" aria-label="Dismiss" onClick={onDismiss}>
          <XIcon />
        </Button>
      </span>
    </li>
  );
}
