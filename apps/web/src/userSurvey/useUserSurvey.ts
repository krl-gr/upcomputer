import {
  type UserSurvey,
  type UserSurveyAnswer,
  type UserSurveyReport,
  USER_SURVEY_RPC_METHODS,
  UserSurveyError,
  UserSurveyRpcGroup,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useEffect, useState } from "react";

import {
  requestExperimentalFeatureRpc,
  useExperimentalFeatureRpcPermission,
} from "../product/FeatureRpc";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import type { SubmitUserSurvey } from "./UserSurveyDialog";

// A computer can qualify while the app stays open; the server answers from memory.
const RECHECK_INTERVAL_MS = 60 * 60_000;
const isUserSurveyError = Schema.is(UserSurveyError);
const SEND_FAILED = "Couldn't send. Check your connection and try again.";

export interface UserSurveyHandle {
  readonly survey: UserSurvey;
  readonly shown: () => void;
  /** Every answer confirmed so far; the server sends them as a partial response. */
  readonly partial: (answers: ReadonlyArray<UserSurveyAnswer>) => void;
  /** Dismisses the survey for good, from the step the person left on. */
  readonly dismiss: (step: { readonly questionId: string; readonly index: number }) => void;
  readonly submit: SubmitUserSurvey;
  /** Drops the card once the thank-you is closed. */
  readonly finish: () => void;
}

/**
 * The survey this computer's server offers once it qualifies, from the primary
 * environment only: other environments are the same person's other servers.
 */
export function useUserSurvey(): UserSurveyHandle | null {
  const environmentId = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const connected =
    environmentId !== null &&
    environments.some(
      (environment) =>
        environment.environmentId === environmentId && environment.connection.phase === "connected",
    );
  const canAnswer = useExperimentalFeatureRpcPermission(
    environmentId,
    USER_SURVEY_RPC_METHODS.report,
  );
  const [survey, setSurvey] = useState<UserSurvey | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- asks the server again as the computer may come to qualify
  useEffect(() => {
    if (!connected || environmentId === null) return;
    let current = true;
    const load = () =>
      void requestExperimentalFeatureRpc(environmentId, UserSurveyRpcGroup, (client) =>
        client[USER_SURVEY_RPC_METHODS.current]({}),
      ).then(
        (state) => {
          if (current) setSurvey(state.survey);
        },
        () => undefined,
      );
    load();
    const timer = setInterval(load, RECHECK_INTERVAL_MS);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [connected, environmentId]);

  if (survey === null || environmentId === null || !canAnswer) return null;
  const report = (input: UserSurveyReport) =>
    requestExperimentalFeatureRpc(
      environmentId,
      UserSurveyRpcGroup,
      (client) => client[USER_SURVEY_RPC_METHODS.report](input),
      { method: USER_SURVEY_RPC_METHODS.report, input },
    );
  const reportQuietly = (input: UserSurveyReport) => void report(input).catch(() => undefined);
  return {
    survey,
    shown: () => reportQuietly({ _tag: "Shown", surveyId: survey.id }),
    partial: (answers) => reportQuietly({ _tag: "Partial", surveyId: survey.id, answers }),
    dismiss: (step) => {
      setSurvey(null);
      reportQuietly({ _tag: "Dismissed", surveyId: survey.id, step });
    },
    submit: async (answers) => {
      try {
        await report({ _tag: "Answered", surveyId: survey.id, answers });
        return null;
      } catch (failure) {
        return isUserSurveyError(failure) ? failure.message : SEND_FAILED;
      }
    },
    finish: () => setSurvey(null),
  };
}
