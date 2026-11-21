import "./sendFeedbackHint.css";

import { T } from "gt-react";
import { BellIcon, ChartNoAxesColumnIcon, MessageSquareTextIcon } from "lucide-react";

// The scene is drawn at the app's own sizes, then shown at three quarters.
const STAGE = { width: 248, height: 172, scale: 0.75 } as const;

function SendFeedbackLabel() {
  return (
    <>
      <MessageSquareTextIcon className="size-3" />
      <T>Send feedback</T>
    </>
  );
}

/**
 * A corner of the app in small: the pointer clicks the bell, the notifications
 * popover opens and Send feedback lights up. It loops; reduced motion gets the
 * last frame as a still.
 */
function SendFeedbackLoop() {
  return (
    <div
      aria-hidden
      className="relative shrink-0 overflow-hidden rounded-lg bg-background ring-1 ring-foreground/8"
      style={{ width: STAGE.width * STAGE.scale, height: STAGE.height * STAGE.scale }}
    >
      <div
        data-sfh="stage"
        className="absolute top-0 left-0 origin-top-left"
        style={{ width: STAGE.width, height: STAGE.height, scale: STAGE.scale }}
      >
        <div className="absolute inset-y-0 left-0 w-26 border-r border-foreground/7 bg-sidebar">
          <div className="flex flex-col gap-3 px-3 pt-4">
            <span className="h-2 w-16 rounded-full bg-foreground/9" />
            <span className="h-2 w-11 rounded-full bg-foreground/9" />
            <span className="h-2 w-18 rounded-full bg-foreground/9" />
            <span className="h-2 w-13 rounded-full bg-foreground/9" />
          </div>
          <div className="absolute bottom-2 left-5 flex gap-2 text-sidebar-muted-foreground/80">
            <span className="grid size-8 place-items-center [&_svg]:size-4">
              <ChartNoAxesColumnIcon />
            </span>
            <span className="relative grid size-8 place-items-center [&_svg]:size-4">
              <span
                data-sfh="bell-lit"
                className="absolute inset-0 rounded-lg bg-sidebar-row-hover"
              />
              <BellIcon className="relative text-sidebar-foreground" />
            </span>
          </div>
        </div>
        <div className="absolute top-4 right-4 left-30 flex flex-col gap-3">
          <span className="h-2 w-20 self-end rounded-full bg-foreground/9" />
          <span className="h-2 w-24 rounded-full bg-foreground/6" />
          <span className="h-2 w-16 rounded-full bg-foreground/6" />
        </div>
        <div
          data-sfh="popover"
          className="absolute bottom-11 left-15 w-45 rounded-lg border border-foreground/10 bg-popover px-3 pt-2 pb-2 text-popover-foreground shadow-lg"
        >
          <p className="flex min-h-7 items-center px-1 pb-1.5 text-sm leading-none font-semibold">
            <T>Notifications</T>
          </p>
          <div className="flex items-center gap-2 rounded-lg bg-foreground/4 p-2">
            <span className="size-6 shrink-0 rounded-md bg-foreground/8" />
            <span className="flex flex-col gap-1.5">
              <span className="h-1.5 w-18 rounded-full bg-foreground/14" />
              <span className="h-1.5 w-12 rounded-full bg-foreground/8" />
            </span>
          </div>
          <div className="mt-2 flex border-t border-foreground/7 pt-1.5">
            <span className="relative inline-flex h-7 items-center gap-1.5 px-2.5 text-xs font-medium whitespace-nowrap text-muted-foreground">
              <SendFeedbackLabel />
              <span
                data-sfh="button-lit"
                className="absolute inset-0 inline-flex items-center gap-1.5 rounded-lg bg-foreground/8 px-2.5 text-foreground"
              >
                <SendFeedbackLabel />
              </span>
            </span>
          </div>
        </div>
        <svg
          viewBox="0 0 20 20"
          data-sfh="pointer"
          className="absolute top-0 left-0 size-5 origin-top-left drop-shadow-sm"
        >
          <path
            d="M4 2.5v13.2l3.5-3.3 2.3 5.3 2.3-1-2.3-5.2h4.9L4 2.5Z"
            className="fill-black stroke-white"
            strokeWidth={1.25}
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}

/** After the survey's thank-you: where feedback lives from now on. */
export function SendFeedbackHint() {
  return (
    // A container, so a narrow dialog stacks the picture over the line whatever the window's width.
    <div className="@container w-full">
      <div className="flex items-center gap-4 rounded-xl bg-foreground/4 p-3 text-left @max-sm:flex-col @max-sm:items-stretch @max-sm:gap-3">
        <div className="flex justify-center">
          <SendFeedbackLoop />
        </div>
        <p className="min-w-0 flex-1 text-sm leading-5 text-balance @max-sm:px-1 @max-sm:pb-1 @max-sm:text-center">
          <span className="block font-medium">
            <T>Found a bug or have an idea?</T>
          </span>
          <span className="block text-muted-foreground">
            <T>You can send it anytime from Notifications.</T>
          </span>
        </p>
      </div>
    </div>
  );
}
