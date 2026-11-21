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

/** What "Include app version and system info" adds, as its disclosure lists it. */
export interface FeedbackSystemInfo {
  readonly appVersion: string;
  /** The operating system and its version; null when the server did not say. */
  readonly system: string | null;
  /** Names of the connected providers. */
  readonly providers: ReadonlyArray<string>;
}

/** The email the field shows: what was typed, else the Connect account's. */
export function feedbackEmail(draft: FeedbackDraft, accountEmail: string | null): string {
  return draft.email ?? accountEmail ?? "";
}

export function canSendFeedback(draft: FeedbackDraft): boolean {
  return draft.text.trim().length > 0;
}
