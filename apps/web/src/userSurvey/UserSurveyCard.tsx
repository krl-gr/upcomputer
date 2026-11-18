import { ChevronRightIcon, CircleQuestionMarkIcon } from "lucide-react";
import { useId } from "react";

import { InlineButton } from "../components/ui/button";
import { NotificationButton, NotificationCard } from "../sidebarNotifications/NotificationCard";
import { USER_SURVEY_CARD_DETAIL, USER_SURVEY_TITLE } from "./surveyParts";
import type { SurveyCardLayout } from "./surveyVariant";

const DISMISS_LABEL = "No thanks";

/** The survey's card in the notifications popover, in the layout under review. */
export function UserSurveyCard({
  layout,
  onShare,
  onDismiss,
}: {
  readonly layout: SurveyCardLayout;
  readonly onShare: () => void;
  readonly onDismiss: () => void;
}) {
  const icon = <CircleQuestionMarkIcon />;
  if (layout === "whole") return <WholeCard onShare={onShare} onDismiss={onDismiss} />;
  if (layout === "buttons") {
    return (
      <NotificationCard
        tone="neutral"
        icon={icon}
        title={USER_SURVEY_TITLE}
        detail={USER_SURVEY_CARD_DETAIL}
        below={
          <div className="flex items-center gap-1">
            <NotificationButton tone="primary" onClick={onShare}>
              Share
            </NotificationButton>
            <NotificationButton tone="ghost" onClick={onDismiss}>
              {DISMISS_LABEL}
            </NotificationButton>
          </div>
        }
      />
    );
  }
  if (layout === "link") {
    return (
      <NotificationCard
        tone="neutral"
        icon={icon}
        title={USER_SURVEY_TITLE}
        detail={USER_SURVEY_CARD_DETAIL}
        action={
          <NotificationButton tone="secondary" onClick={onShare}>
            Share
          </NotificationButton>
        }
        links={
          <InlineButton tone="muted" onClick={onDismiss}>
            {DISMISS_LABEL}
          </InlineButton>
        }
      />
    );
  }
  return (
    <NotificationCard
      tone="neutral"
      icon={icon}
      title={USER_SURVEY_TITLE}
      detail={USER_SURVEY_CARD_DETAIL}
      action={
        <NotificationButton tone="secondary" onClick={onShare}>
          Share
        </NotificationButton>
      }
      onDismiss={onDismiss}
    />
  );
}

/**
 * The whole card opens the survey. Its button is stretched under the text, so
 * the dismiss link stays a separate control and never nests inside it.
 */
function WholeCard({
  onShare,
  onDismiss,
}: {
  readonly onShare: () => void;
  readonly onDismiss: () => void;
}) {
  const titleId = useId();
  const detailId = useId();
  return (
    <li className="group/card relative rounded-lg bg-foreground/4 transition-colors hover:bg-foreground/8 motion-reduce:transition-none">
      <button
        type="button"
        aria-labelledby={titleId}
        aria-describedby={detailId}
        className="absolute inset-0 cursor-pointer rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={onShare}
      />
      <div className="pointer-events-none relative grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-start gap-x-2.5 gap-y-0.5 p-2.5">
        <span
          aria-hidden
          className="row-span-2 grid size-7 place-items-center rounded-lg bg-foreground/8 text-foreground [&_svg]:size-4"
        >
          <CircleQuestionMarkIcon />
        </span>
        <p id={titleId} className="text-sm leading-4.5 font-medium text-balance">
          {USER_SURVEY_TITLE}
        </p>
        <ChevronRightIcon
          aria-hidden
          className="col-start-3 row-span-2 row-start-1 size-4 self-center text-muted-foreground transition-[translate,color] duration-150 group-hover/card:translate-x-0.5 group-hover/card:text-foreground motion-reduce:transition-none"
        />
        <p className="col-start-2 text-xs leading-4 text-muted-foreground">
          <span id={detailId}>{USER_SURVEY_CARD_DETAIL}</span>
          {/* Shown on hover and keyboard focus; always on touch, which has neither. */}
          <span className="pointer-events-auto opacity-0 transition-opacity duration-150 group-focus-within/card:opacity-100 group-hover/card:opacity-100 pointer-coarse:opacity-100 motion-reduce:transition-none">
            <span aria-hidden className="mx-1">
              ·
            </span>
            <InlineButton tone="muted" onClick={onDismiss}>
              {DISMISS_LABEL}
            </InlineButton>
          </span>
        </p>
      </div>
    </li>
  );
}
