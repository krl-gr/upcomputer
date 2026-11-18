import type { UserSurvey, UserSurveyAnswer, UserSurveyQuestion } from "@t3tools/contracts";
import { cva, type VariantProps } from "class-variance-authority";
import { CheckIcon, PlusIcon } from "lucide-react";
import { type ComponentProps, type ReactNode, useState } from "react";

import { APP_BASE_NAME } from "../branding";
import { Spinner } from "../components/ui/spinner";
import { observeResize } from "../lib/observeResize";
import { cn } from "../lib/utils";
import {
  type ChoiceQuestion,
  EMPTY_DRAFT_ANSWER,
  isContactQuestion,
  isOpenChoice,
  pickChoice,
  type SurveyDraft,
  type SurveyDraftAnswer,
  surveyAnswers,
} from "./userSurvey.logic";

export const USER_SURVEY_TITLE = `How can we improve ${APP_BASE_NAME} for you?`;
export const USER_SURVEY_THANKS = "This helps us decide what to build next.";

export type UserSurveyStatus =
  | { readonly kind: "editing" }
  | { readonly kind: "submitting" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "sent" };

/** Sends the answers; resolves to an error message, or null once they are sent. */
export type SubmitUserSurvey = (answers: ReadonlyArray<UserSurveyAnswer>) => Promise<string | null>;

/** What the survey's card and form draw from. */
export interface SurveyFormProps {
  readonly survey: UserSurvey;
  readonly draft: SurveyDraft;
  readonly status: UserSurveyStatus;
  /** The step on screen, and whether it was reached by going back. */
  readonly step: number;
  readonly back: boolean;
  readonly onDraftChange: (draft: SurveyDraft) => void;
  readonly onStepChange: (step: number) => void;
  readonly onSubmit: () => void;
  readonly onClose: () => void;
  /** Back from the first step: the card, where the first answer can be changed. */
  readonly onBackToCard: () => void;
}

interface SurveyFormState {
  readonly surveyId: string | null;
  readonly draft: SurveyDraft;
  readonly status: UserSurveyStatus;
  readonly step: number;
  readonly back: boolean;
}

/**
 * The draft, the step and the send status, kept by whoever outlives the form,
 * so the card can answer the first question and closing keeps what was typed.
 * A new survey starts empty.
 */
export function useSurveyForm(survey: UserSurvey | null, onSubmit: SubmitUserSurvey | null) {
  const surveyId = survey?.id ?? null;
  const fresh: SurveyFormState = {
    surveyId,
    draft: {},
    status: { kind: "editing" },
    step: 0,
    back: false,
  };
  const [stored, setStored] = useState(fresh);
  const state = stored.surveyId === surveyId ? stored : fresh;
  const update = (change: (current: SurveyFormState) => Partial<SurveyFormState>) =>
    setStored((current) => {
      const base = current.surveyId === surveyId ? current : fresh;
      return { ...base, ...change(base) };
    });
  return {
    draft: state.draft,
    status: state.status,
    step: state.step,
    back: state.back,
    setDraft: (draft: SurveyDraft) => update(() => ({ draft })),
    goTo: (step: number) => update((current) => ({ step, back: step < current.step })),
    /** The card's answer: the form opens on its first step with it already given. */
    start: (draft: SurveyDraft) => update(() => ({ draft, step: 0, back: false })),
    submit: () => {
      if (!survey || !onSubmit) return;
      update(() => ({ status: { kind: "submitting" } }));
      void onSubmit(surveyAnswers(survey, state.draft)).then((message) =>
        update(() => ({
          status: message === null ? { kind: "sent" } : { kind: "failed", message },
        })),
      );
    },
  };
}

const chipVariants = cva(
  "inline-flex max-w-full shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap outline-none select-none transition-[background-color,color,scale] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:scale-[0.97] disabled:pointer-events-none motion-reduce:transition-none motion-reduce:active:scale-100",
  {
    variants: {
      // sm sits in the notification card; lg is the form's, a step above a sidebar row.
      size: {
        sm: "h-7 px-2.5 text-xs [&_svg]:size-3",
        lg: "h-9 px-3.5 text-sm [&_svg]:size-3.5",
      },
      picked: {
        true: "bg-foreground text-background",
        false: "bg-foreground/6 text-foreground hover:bg-foreground/11",
      },
    },
  },
);

export type SurveyChipSize = NonNullable<VariantProps<typeof chipVariants>["size"]>;

export function SurveyChip({
  size,
  picked,
  multiple,
  children,
  ...props
}: Omit<ComponentProps<"button">, "className"> & {
  readonly size: SurveyChipSize;
  readonly picked: boolean;
  readonly multiple: boolean;
}) {
  return (
    <button
      type="button"
      role={multiple ? undefined : "radio"}
      aria-checked={multiple ? undefined : picked}
      aria-pressed={multiple ? picked : undefined}
      className={chipVariants({ size, picked })}
      {...props}
    >
      {multiple ? (
        picked ? (
          <CheckIcon aria-hidden strokeWidth={2.5} className="-ml-0.5" />
        ) : (
          <PlusIcon aria-hidden className="-ml-0.5 opacity-55" />
        )
      ) : null}
      <span className="truncate">{children}</span>
    </button>
  );
}

/** Fades its content in, once, when it mounts. `SurveyAutoHeight` makes the room. */
function FadeIn({ children }: { readonly children: ReactNode }) {
  return (
    <div className="opacity-100 transition-opacity duration-200 ease-out starting:opacity-0 motion-reduce:transition-none">
      {children}
    </div>
  );
}

/**
 * Follows its content's height with a short transition, so a step change or
 * a field opening resizes the form smoothly instead of jumping.
 */
export function SurveyAutoHeight({ children }: { readonly children: ReactNode }) {
  const [height, setHeight] = useState<number | null>(null);
  const observe = (node: HTMLDivElement | null) => {
    if (!node) return;
    return observeResize(node, () => setHeight(node.offsetHeight));
  };
  return (
    <div
      className="overflow-hidden transition-[height] duration-200 ease-out motion-reduce:transition-none"
      style={height === null ? undefined : { height }}
    >
      {/* A flow root, so a child's margin counts in the measured height. */}
      <div ref={observe} className="flow-root">
        {children}
      </div>
    </div>
  );
}

// Focus is a darker fill and a hairline in the text colour, not the blue ring.
const fieldVariants = cva(
  "w-full rounded-lg bg-foreground/5 text-foreground ring-1 ring-transparent outline-none transition-[background-color,box-shadow] duration-150 ring-inset placeholder:text-muted-foreground/75 hover:bg-foreground/7 focus:bg-foreground/8 focus:ring-foreground/16 disabled:opacity-64 max-sm:text-base motion-reduce:transition-none",
  {
    variants: {
      size: {
        sm: "px-2.5 py-1.5 text-xs leading-4.5",
        lg: "px-3 py-2 text-sm leading-5",
      },
    },
  },
);

/** A soft, borderless text box that grows with what is typed. */
function SurveyTextBox({
  size,
  lines = 1,
  ...props
}: Omit<ComponentProps<"textarea">, "className" | "rows"> & {
  readonly size: SurveyChipSize;
  /** The lines it shows while empty. */
  readonly lines?: number;
}) {
  return (
    <textarea
      rows={lines}
      className={cn(
        fieldVariants({ size }),
        "block max-h-48 resize-none field-sizing-content wrap-anywhere",
      )}
      style={{
        minHeight: `calc(${lines}lh + 2 * var(--spacing) * ${size === "sm" ? 1.5 : 2})`,
      }}
      {...props}
    />
  );
}

function ChoiceChips({
  question,
  answer,
  onChange,
  size,
}: {
  readonly question: ChoiceQuestion;
  readonly answer: SurveyDraftAnswer;
  readonly onChange: (answer: SurveyDraftAnswer) => void;
  readonly size: SurveyChipSize;
}) {
  const multiple = question.type === "multiple_choice";
  const openPicked = question.choices.some(
    (_, index) => isOpenChoice(question, index) && answer.picked.includes(index),
  );
  return (
    <>
      <div
        role={multiple ? "group" : "radiogroup"}
        aria-label={question.question}
        className={cn("flex flex-wrap", size === "sm" ? "gap-1" : "gap-1.5")}
      >
        {question.choices.map((choice, index) => {
          const picked = answer.picked.includes(index);
          return (
            <SurveyChip
              key={choice}
              size={size}
              multiple={multiple}
              picked={picked}
              onClick={() => onChange(pickChoice(question, answer, index, !picked))}
            >
              {choice}
            </SurveyChip>
          );
        })}
      </div>
      {openPicked ? (
        <FadeIn>
          <div className={size === "sm" ? "pt-1.5" : "pt-2"}>
            <SurveyTextBox
              size={size}
              aria-label={question.choices.at(-1)}
              lines={3}
              placeholder="What else?"
              autoFocus
              value={answer.otherText}
              onChange={(event) => onChange({ ...answer, otherText: event.target.value })}
            />
          </div>
        </FadeIn>
      ) : null}
    </>
  );
}

/** One question's answer control: chips for choices, a text box for words. */
export function SurveyAnswerInput({
  question,
  draft,
  onDraftChange,
  size,
  followUp = false,
  autoFocus = false,
}: {
  readonly question: UserSurveyQuestion;
  readonly draft: SurveyDraft;
  readonly onDraftChange: (draft: SurveyDraft) => void;
  readonly size: SurveyChipSize;
  /** A follow-up's text box carries its question as the placeholder. */
  readonly followUp?: boolean;
  readonly autoFocus?: boolean;
}) {
  const answer = draft[question.id] ?? EMPTY_DRAFT_ANSWER;
  const onChange = (next: SurveyDraftAnswer) => onDraftChange({ ...draft, [question.id]: next });
  if (isContactQuestion(question)) {
    return (
      <input
        type="text"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="off"
        spellCheck={false}
        className={fieldVariants({ size })}
        aria-label={question.question}
        placeholder={question.description ?? "you@example.com or @handle"}
        autoFocus={autoFocus}
        value={answer.text}
        onChange={(event) => onChange({ ...answer, text: event.target.value })}
      />
    );
  }
  if (question.type === "open") {
    return (
      <SurveyTextBox
        size={size}
        lines={followUp ? 3 : 4}
        aria-label={question.question}
        // PostHog's description, when set, is the hint inside the box.
        placeholder={
          followUp ? question.question : (question.description ?? "Type your answer here")
        }
        autoFocus={autoFocus || followUp}
        value={answer.text}
        onChange={(event) => onChange({ ...answer, text: event.target.value })}
      />
    );
  }
  return <ChoiceChips question={question} answer={answer} onChange={onChange} size={size} />;
}

/** The follow-ups a picked choice opens, right under the chips. */
export function SurveyFollowUps({
  followUps,
  draft,
  onDraftChange,
  size,
}: {
  readonly followUps: ReadonlyArray<UserSurveyQuestion>;
  readonly draft: SurveyDraft;
  readonly onDraftChange: (draft: SurveyDraft) => void;
  readonly size: SurveyChipSize;
}) {
  return followUps.map((followUp) => (
    <FadeIn key={followUp.id}>
      <div className={cn("flex flex-col gap-1.5", size === "sm" ? "pt-1.5" : "pt-2")}>
        {followUp.type === "open" ? null : (
          <span className="text-xs text-muted-foreground">{followUp.question}</span>
        )}
        <SurveyAnswerInput
          question={followUp}
          draft={draft}
          onDraftChange={onDraftChange}
          size={size}
          followUp
        />
      </div>
    </FadeIn>
  ));
}

const actionVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap outline-none select-none transition-[background-color,color,opacity,scale] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:scale-[0.97] disabled:pointer-events-none disabled:opacity-35 motion-reduce:transition-none motion-reduce:active:scale-100",
  {
    variants: {
      size: {
        sm: "h-7 px-2.5 text-xs [&_svg]:size-3",
        lg: "h-9 px-4 text-sm [&_svg]:size-3.5",
      },
      tone: {
        primary: "bg-foreground text-background hover:bg-foreground/85",
        quiet: "text-muted-foreground hover:bg-foreground/6 hover:text-foreground",
        soft: "bg-foreground/6 text-foreground hover:bg-foreground/11",
      },
    },
  },
);

export function SurveyAction({
  size,
  tone,
  ...props
}: Omit<ComponentProps<"button">, "className"> & {
  readonly size: SurveyChipSize;
  readonly tone: NonNullable<VariantProps<typeof actionVariants>["tone"]>;
}) {
  return <button type="button" className={actionVariants({ size, tone })} {...props} />;
}

/**
 * The last step's button: Send, or a quiet Skip while that step is empty.
 * Both send the answers, and both turn into Sending and Try again.
 */
export function SurveySendAction({
  size,
  status,
  skip,
  disabled,
}: {
  readonly size: SurveyChipSize;
  readonly status: UserSurveyStatus;
  /** The step is optional and empty: sending leaves it out. */
  readonly skip: boolean;
  readonly disabled: boolean;
}) {
  const submitting = status.kind === "submitting";
  const idle = status.kind === "editing";
  return (
    <SurveyAction
      type="submit"
      size={size}
      tone={skip && idle ? "soft" : "primary"}
      disabled={disabled || submitting}
    >
      {submitting ? <Spinner /> : null}
      {submitting ? "Sending…" : status.kind === "failed" ? "Try again" : skip ? "Skip" : "Send"}
    </SurveyAction>
  );
}

export function SurveyError({ status }: { readonly status: UserSurveyStatus }) {
  if (status.kind !== "failed") return null;
  return (
    <p role="alert" className="min-w-0 flex-1 text-xs leading-4 text-destructive-foreground">
      {status.message}
    </p>
  );
}

/** The thank-you check: the disc grows in and the tick draws itself, once. */
export function SurveyThanksMark() {
  return (
    <span
      aria-hidden
      className="grid size-12 shrink-0 scale-100 place-items-center rounded-full bg-success/14 text-success-foreground opacity-100 transition-[scale,opacity] duration-300 ease-out starting:scale-50 starting:opacity-0 motion-reduce:transition-none"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-6"
      >
        <path
          d="M5 12.5 9.5 17 19 7.5"
          pathLength={1}
          className="transition-[stroke-dashoffset] delay-150 duration-300 ease-out [stroke-dasharray:1] [stroke-dashoffset:0] starting:[stroke-dashoffset:1] motion-reduce:transition-none"
        />
      </svg>
    </span>
  );
}
