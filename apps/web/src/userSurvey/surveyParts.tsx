import type { UserSurvey, UserSurveyAnswer, UserSurveyQuestion } from "@t3tools/contracts";
import { cva, type VariantProps } from "class-variance-authority";
import { CheckIcon, PlusIcon } from "lucide-react";
import { type ComponentProps, type ReactNode, useState } from "react";

import { APP_BASE_NAME } from "../branding";
import { Spinner } from "../components/ui/spinner";
import { cn } from "../lib/utils";
import {
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
export const USER_SURVEY_CARD_DETAIL = "Takes about a minute.";
export const USER_SURVEY_THANKS = "This helps us decide what to build next.";

export type UserSurveyStatus =
  | { readonly kind: "editing" }
  | { readonly kind: "submitting" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "sent" };

/** Sends the answers; resolves to an error message, or null once they are sent. */
export type SubmitUserSurvey = (answers: ReadonlyArray<UserSurveyAnswer>) => Promise<string | null>;

/** What every form of the survey draws from. */
export interface SurveyFormProps {
  readonly survey: UserSurvey;
  readonly draft: SurveyDraft;
  readonly status: UserSurveyStatus;
  readonly onDraftChange: (draft: SurveyDraft) => void;
  readonly onSubmit: () => void;
  readonly onClose: () => void;
}

/** "Three quick questions, about a minute." */
export function surveyLengthLabel(survey: UserSurvey): string {
  const count = surveyBlocks(survey, {}).length;
  const words = ["One", "Two", "Three", "Four", "Five"];
  if (count === 1) return "One quick question.";
  return `${words[count - 1] ?? count} quick questions, about a minute.`;
}

interface SurveyFormState {
  readonly surveyId: string | null;
  readonly draft: SurveyDraft;
  readonly status: UserSurveyStatus;
}

/**
 * The draft and send status, kept by whoever outlives the form, so closing
 * and reopening keeps what was typed. A new survey starts empty.
 */
export function useSurveyForm(survey: UserSurvey | null, onSubmit: SubmitUserSurvey | null) {
  const surveyId = survey?.id ?? null;
  const [stored, setStored] = useState<SurveyFormState>({
    surveyId,
    draft: {},
    status: { kind: "editing" },
  });
  const state: SurveyFormState =
    stored.surveyId === surveyId ? stored : { surveyId, draft: {}, status: { kind: "editing" } };
  const setStatus = (status: UserSurveyStatus) =>
    setStored((current) => (current.surveyId === surveyId ? { ...current, status } : current));
  return {
    draft: state.draft,
    status: state.status,
    setDraft: (draft: SurveyDraft) => setStored({ ...state, draft }),
    submit: () => {
      if (!survey || !onSubmit) return;
      setStored({ ...state, status: { kind: "submitting" } });
      void onSubmit(surveyAnswers(survey, state.draft)).then((message) =>
        setStatus(message === null ? { kind: "sent" } : { kind: "failed", message }),
      );
    },
  };
}

const chipVariants = cva(
  "inline-flex max-w-full shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap outline-none select-none transition-[background-color,color,scale] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:scale-[0.97] disabled:pointer-events-none motion-reduce:transition-none motion-reduce:active:scale-100",
  {
    variants: {
      // md is a sidebar row: 32px tall, the control radius, medium 14px text.
      size: {
        sm: "h-7 px-2.5 text-xs [&_svg]:size-3",
        md: "h-8 px-3 text-sm [&_svg]:size-3.5",
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

function SurveyChip({
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

/** Opens its content from nothing, once, when it mounts. */
export function Reveal({ children }: { readonly children: ReactNode }) {
  return (
    <div className="grid grid-rows-[1fr] opacity-100 transition-[grid-template-rows,opacity] duration-200 ease-out starting:grid-rows-[0fr] starting:opacity-0 motion-reduce:transition-none">
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

const fieldVariants = cva(
  "w-full rounded-lg bg-foreground/5 text-foreground outline-none transition-[background-color,box-shadow] duration-150 placeholder:text-muted-foreground/75 hover:bg-foreground/7 focus:bg-foreground/3 focus:ring-2 focus:ring-ring/70 focus:ring-inset disabled:opacity-64 max-sm:text-base motion-reduce:transition-none",
  {
    variants: {
      size: {
        sm: "px-2.5 py-1.5 text-xs leading-4.5",
        md: "px-3 py-1.75 text-sm leading-5",
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
        "block max-h-40 resize-none field-sizing-content wrap-anywhere",
      )}
      style={{
        minHeight: `calc(${lines}lh + 2 * var(--spacing) * ${size === "sm" ? 1.5 : size === "md" ? 1.75 : 2})`,
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
        <Reveal>
          <div className={size === "sm" ? "pt-1.5" : "pt-2"}>
            <SurveyTextBox
              size={size}
              aria-label={question.choices.at(-1)}
              placeholder="What else?"
              autoFocus
              value={answer.otherText}
              onChange={(event) => onChange({ ...answer, otherText: event.target.value })}
            />
          </div>
        </Reveal>
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
  if (question.type === "open") {
    return (
      <SurveyTextBox
        size={size}
        lines={followUp ? 2 : 3}
        aria-label={question.question}
        placeholder={followUp ? question.question : "Ideas, wishes, rough edges. Anything helps."}
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
    <Reveal key={followUp.id}>
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
    </Reveal>
  ));
}

const actionVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap outline-none select-none transition-[background-color,color,opacity,scale] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:scale-[0.97] disabled:pointer-events-none disabled:opacity-35 motion-reduce:transition-none motion-reduce:active:scale-100",
  {
    variants: {
      size: {
        sm: "h-7 px-3 text-xs [&_svg]:size-3",
        md: "h-8 px-3.5 text-sm [&_svg]:size-3.5",
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

/** The send button in its three faces: Send, Sending and Try again. */
export function SurveySendAction({
  size,
  status,
  disabled,
}: {
  readonly size: SurveyChipSize;
  readonly status: UserSurveyStatus;
  readonly disabled: boolean;
}) {
  const submitting = status.kind === "submitting";
  return (
    <SurveyAction type="submit" size={size} tone="primary" disabled={disabled || submitting}>
      {submitting ? <Spinner /> : null}
      {submitting ? "Sending…" : status.kind === "failed" ? "Try again" : "Send"}
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
export function SurveyThanksMark({ size = "md" }: { readonly size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 scale-100 place-items-center bg-success/14 text-success-foreground opacity-100 transition-[scale,opacity] duration-300 ease-out starting:scale-50 starting:opacity-0 motion-reduce:transition-none",
        size === "sm" ? "size-7 rounded-lg" : "size-12 rounded-full",
      )}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={size === "sm" ? 2.5 : 2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={size === "sm" ? "size-4" : "size-6"}
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
