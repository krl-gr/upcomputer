import {
  PROVIDER_DISPLAY_NAMES,
  type UserFeedback,
  UserFeedbackError,
  type UserFeedbackSystemInfo,
  USER_SURVEY_RPC_METHODS,
  UserSurveyRpcGroup,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useGT } from "gt-react";
import { useState } from "react";

import { APP_VERSION } from "../branding";
import {
  requestExperimentalFeatureRpc,
  useExperimentalFeatureRpcPermission,
} from "../product/FeatureRpc";
import { useServerConfigs } from "../state/entities";
import { useEnvironmentProviders, usePrimaryEnvironmentId } from "../state/environments";
import type { UserSurveyStatus } from "../userSurvey/surveyParts";
import { EMPTY_FEEDBACK_DRAFT, feedbackPayload } from "./sendFeedback.logic";

const OS_LABELS = { darwin: "macOS", linux: "Linux", windows: "Windows", unknown: null } as const;
const isUserFeedbackError = Schema.is(UserFeedbackError);

/** Sends the feedback; resolves to an error message, or null once it is sent. */
type SubmitFeedback = (feedback: UserFeedback) => Promise<string | null>;

export interface SendFeedbackSource {
  readonly available: boolean;
  readonly systemInfo: UserFeedbackSystemInfo;
  readonly submit: SubmitFeedback;
}

/** Whether this client may send feedback: false without a server or on a read-only pairing. */
export function useSendFeedbackAvailable(): boolean {
  const environmentId = usePrimaryEnvironmentId();
  const allowed = useExperimentalFeatureRpcPermission(
    environmentId,
    USER_SURVEY_RPC_METHODS.feedback,
  );
  return environmentId !== null && allowed;
}

/**
 * Where the feedback form gets the system info it lists and its Send: the
 * primary environment's server, which sends it on like a survey answer.
 */
export function useSendFeedback(): SendFeedbackSource {
  const gt = useGT();
  const environmentId = usePrimaryEnvironmentId();
  const configs = useServerConfigs();
  const providersByEnvironment = useEnvironmentProviders();
  const available = useSendFeedbackAvailable();
  const platform = environmentId === null ? null : configs.get(environmentId)?.environment.platform;
  const providers = environmentId === null ? [] : (providersByEnvironment.get(environmentId) ?? []);
  const connected = providers
    .filter(
      (provider) =>
        provider.enabled && provider.installed && provider.auth.status === "authenticated",
    )
    .map((provider) => PROVIDER_DISPLAY_NAMES[provider.driver] ?? provider.driver);
  const os = platform ? OS_LABELS[platform.os] : null;
  const sendFailed = gt("Couldn't send. Check your connection and try again.");
  return {
    available,
    systemInfo: {
      appVersion: APP_VERSION,
      system: os && platform ? `${os} (${platform.arch})` : os,
      providers: [...new Set(connected)],
    },
    submit: async (feedback) => {
      if (environmentId === null) return sendFailed;
      try {
        await requestExperimentalFeatureRpc(
          environmentId,
          UserSurveyRpcGroup,
          (client) => client[USER_SURVEY_RPC_METHODS.feedback](feedback),
          { method: USER_SURVEY_RPC_METHODS.feedback, input: feedback },
        );
        return null;
      } catch (failure) {
        return isUserFeedbackError(failure) && failure.reason === "unavailable"
          ? gt("Your organization has turned off sending feedback.")
          : sendFailed;
      }
    },
  };
}

export type SendFeedbackForm = ReturnType<typeof useSendFeedbackForm>;

/** The draft and the send status, kept by whoever outlives the form, so closing keeps the text. */
export function useSendFeedbackForm(source: SendFeedbackSource) {
  const [draft, setDraft] = useState(EMPTY_FEEDBACK_DRAFT);
  const [status, setStatus] = useState<UserSurveyStatus>({ kind: "editing" });
  return {
    draft,
    status,
    setDraft,
    submit: (accountEmail: string | null) => {
      setStatus({ kind: "submitting" });
      void source
        .submit(feedbackPayload(draft, accountEmail, source.systemInfo))
        .then((message) =>
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
