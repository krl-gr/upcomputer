import { ChevronUpIcon, CircleQuestionMarkIcon, XIcon } from "lucide-react";

import { Button } from "../components/ui/button";
import { NotificationButton } from "../sidebarNotifications/NotificationCard";
import {
  Reveal,
  type SurveyFormProps,
  SurveyAnswerInput,
  SurveyError,
  SurveyFollowUps,
  SurveySendAction,
  SurveyThanksMark,
  USER_SURVEY_CARD_DETAIL,
  USER_SURVEY_THANKS,
  USER_SURVEY_TITLE,
} from "./surveyParts";
import { canSubmitSurvey, surveyBlocks } from "./userSurvey.logic";

/**
 * Direction B: the notification card opens into the form where it sits, in
 * the popover. Its shell and header are a notification card's.
 */
export function UserSurveyInlineCard({
  survey,
  draft,
  status,
  onDraftChange,
  onSubmit,
  onClose,
  expanded,
  onExpandedChange,
  onDismiss,
}: SurveyFormProps & {
  readonly expanded: boolean;
  readonly onExpandedChange: (expanded: boolean) => void;
  readonly onDismiss: () => void;
}) {
  const sent = status.kind === "sent";
  const submitting = status.kind === "submitting";
  return (
    <li className="relative flex flex-col rounded-lg bg-foreground/4 p-2.5">
      <div className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-start gap-x-2.5 gap-y-0.5">
        {sent ? (
          <span className="row-span-2">
            <SurveyThanksMark size="sm" />
          </span>
        ) : (
          <span
            aria-hidden
            className="row-span-2 grid size-7 place-items-center rounded-lg bg-foreground/8 text-foreground [&_svg]:size-4"
          >
            <CircleQuestionMarkIcon />
          </span>
        )}
        <p className="pr-4 text-sm leading-4.5 font-medium">
          {sent ? "Thank you!" : USER_SURVEY_TITLE}
        </p>
        {expanded || sent ? null : (
          <div className="relative z-1 col-start-3 row-span-2 row-start-1 flex items-center self-center">
            <NotificationButton tone="secondary" onClick={() => onExpandedChange(true)}>
              Share
            </NotificationButton>
          </div>
        )}
        <p className="col-start-2 text-xs leading-4 text-muted-foreground">
          {sent ? USER_SURVEY_THANKS : USER_SURVEY_CARD_DETAIL}
        </p>
      </div>
      {expanded && !sent ? (
        <Reveal>
          <form
            className="flex flex-col gap-4 pt-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!submitting && canSubmitSurvey(survey, draft)) onSubmit();
            }}
          >
            {surveyBlocks(survey, draft).map(({ question, followUps }) => (
              <fieldset key={question.id} disabled={submitting} className="flex min-w-0 flex-col">
                <legend className="mb-2 flex w-full items-baseline gap-1.5 text-xs font-semibold">
                  {question.question}
                  {question.type === "multiple_choice" ? (
                    <span className="font-normal text-muted-foreground">Pick any</span>
                  ) : null}
                </legend>
                <SurveyAnswerInput
                  question={question}
                  draft={draft}
                  onDraftChange={onDraftChange}
                  size="sm"
                />
                <SurveyFollowUps
                  followUps={followUps}
                  draft={draft}
                  onDraftChange={onDraftChange}
                  size="sm"
                />
              </fieldset>
            ))}
            <div className="flex items-center justify-end gap-2.5">
              <SurveyError status={status} />
              <SurveySendAction
                size="sm"
                status={status}
                disabled={!canSubmitSurvey(survey, draft)}
              />
            </div>
          </form>
        </Reveal>
      ) : null}
      <span className="absolute top-1.5 right-1.5">
        {sent ? (
          <Button size="icon-micro" variant="ghost-muted" aria-label="Close" onClick={onClose}>
            <XIcon />
          </Button>
        ) : expanded ? (
          <Button
            size="icon-micro"
            variant="ghost-muted"
            aria-label="Collapse"
            onClick={() => onExpandedChange(false)}
          >
            <ChevronUpIcon />
          </Button>
        ) : (
          <Button size="icon-micro" variant="ghost-muted" aria-label="Dismiss" onClick={onDismiss}>
            <XIcon />
          </Button>
        )}
      </span>
    </li>
  );
}
