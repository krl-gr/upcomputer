import type { UserFeedback, UserFeedbackSystemInfo } from "@t3tools/contracts";

export interface FeedbackDraft {
  readonly text: string;
  readonly includeSystemInfo: boolean;
  readonly canEmail: boolean;
  /** Null until the person edits it: the field then shows the Connect account's email. */
  readonly email: string | null;
}

export const EMPTY_FEEDBACK_DRAFT: FeedbackDraft = {
  text: "",
  includeSystemInfo: true,
  canEmail: false,
  email: null,
};

/** The email the field shows: what was typed, else the Connect account's. */
export function feedbackEmail(draft: FeedbackDraft, accountEmail: string | null): string {
  return draft.email ?? accountEmail ?? "";
}

export function canSendFeedback(draft: FeedbackDraft): boolean {
  return draft.text.trim().length > 0;
}

/** What Send sends: the email and the system info only when their boxes are checked. */
export function feedbackPayload(
  draft: FeedbackDraft,
  accountEmail: string | null,
  systemInfo: UserFeedbackSystemInfo,
): UserFeedback {
  const email = draft.canEmail ? feedbackEmail(draft, accountEmail).trim() : "";
  return {
    text: draft.text.trim(),
    ...(email === "" ? {} : { email }),
    ...(draft.includeSystemInfo ? { systemInfo } : {}),
  };
}
