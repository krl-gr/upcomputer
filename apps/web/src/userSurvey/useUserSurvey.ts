import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { type UserSurvey, type UserSurveyAnswer, UserSurveyError } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useEffect, useState } from "react";

import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
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
  const canAnswer = useAtomValue(serverEnvironment.reportUserSurvey.permissionAtom(environmentId));
  const getSurvey = useAtomCommand(serverEnvironment.getUserSurvey, { reportFailure: false });
  const report = useAtomCommand(serverEnvironment.reportUserSurvey, { reportFailure: false });
  const [survey, setSurvey] = useState<UserSurvey | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- asks the server again as the computer may come to qualify
  useEffect(() => {
    if (!connected || environmentId === null) return;
    let current = true;
    const load = () =>
      void getSurvey({ environmentId, input: {} }).then((result) => {
        if (current && result._tag === "Success") setSurvey(result.value.survey);
      });
    load();
    const timer = setInterval(load, RECHECK_INTERVAL_MS);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [connected, environmentId, getSurvey]);

  if (survey === null || environmentId === null || !canAnswer) return null;
  return {
    survey,
    shown: () => void report({ environmentId, input: { _tag: "Shown", surveyId: survey.id } }),
    partial: (answers) =>
      void report({ environmentId, input: { _tag: "Partial", surveyId: survey.id, answers } }),
    dismiss: (step) => {
      setSurvey(null);
      void report({ environmentId, input: { _tag: "Dismissed", surveyId: survey.id, step } });
    },
    submit: async (answers) => {
      const result = await report({
        environmentId,
        input: { _tag: "Answered", surveyId: survey.id, answers },
      });
      if (result._tag === "Success") return null;
      const failure = squashAtomCommandFailure(result);
      return isUserSurveyError(failure) ? failure.message : SEND_FAILED;
    },
    finish: () => setSurvey(null),
  };
}
