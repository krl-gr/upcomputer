import { PROVIDER_DISPLAY_NAMES } from "@t3tools/contracts";
import { useState } from "react";

import { APP_VERSION } from "../branding";
import { useServerConfigs } from "../state/entities";
import { useEnvironmentProviders, usePrimaryEnvironmentId } from "../state/environments";
import type { UserSurveyStatus } from "../userSurvey/surveyParts";
import {
  EMPTY_FEEDBACK_DRAFT,
  type FeedbackDraft,
  type FeedbackSystemInfo,
} from "./sendFeedback.logic";

const OS_LABELS = { darwin: "macOS", linux: "Linux", windows: "Windows", unknown: null } as const;

/** Sends the feedback; resolves to an error message, or null once it is sent. */
export type SubmitFeedback = (draft: FeedbackDraft) => Promise<string | null>;

export interface SendFeedbackSource {
  /** The UpComputer Connect account's email, when signed in. */
  readonly accountEmail: string | null;
  readonly systemInfo: FeedbackSystemInfo;
  readonly submit: SubmitFeedback;
}

/** Where the feedback form gets the account, the system info it lists, and its Send. */
export function useSendFeedback(): SendFeedbackSource {
  const environmentId = usePrimaryEnvironmentId();
  const configs = useServerConfigs();
  const providersByEnvironment = useEnvironmentProviders();
  const platform = environmentId === null ? null : configs.get(environmentId)?.environment.platform;
  const providers = environmentId === null ? [] : (providersByEnvironment.get(environmentId) ?? []);
  const connected = providers
    .filter(
      (provider) =>
        provider.enabled && provider.installed && provider.auth.status === "authenticated",
    )
    .map((provider) => PROVIDER_DISPLAY_NAMES[provider.driver] ?? provider.driver);
  const os = platform ? OS_LABELS[platform.os] : null;
  return {
    // Design phase: the Connect account's email is not read yet.
    accountEmail: null,
    systemInfo: {
      appVersion: APP_VERSION,
      system: os && platform ? `${os} (${platform.arch})` : os,
      providers: [...new Set(connected)],
    },
    // Design phase: nothing is sent yet. The developer phase puts the server call here.
    submit: () => new Promise((resolve) => setTimeout(() => resolve(null), 900)),
  };
}

export type SendFeedbackForm = ReturnType<typeof useSendFeedbackForm>;

/** The draft and the send status, kept by whoever outlives the form, so closing keeps the text. */
export function useSendFeedbackForm(submit: SubmitFeedback) {
  const [draft, setDraft] = useState(EMPTY_FEEDBACK_DRAFT);
  const [status, setStatus] = useState<UserSurveyStatus>({ kind: "editing" });
  return {
    draft,
    status,
    setDraft,
    submit: () => {
      setStatus({ kind: "submitting" });
      void submit(draft).then((message) =>
        setStatus(message === null ? { kind: "sent" } : { kind: "failed", message }),
      );
    },
    /** After the thank-you: the next feedback starts empty. */
    reset: () => {
      setDraft(EMPTY_FEEDBACK_DRAFT);
      setStatus({ kind: "editing" });
    },
  };
}
