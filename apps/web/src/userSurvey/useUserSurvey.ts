import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { type UserSurvey, UserSurveyError } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useEffect, useState } from "react";

import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import type { SubmitUserSurvey } from "./UserSurveyDialog";

// The server reads PostHog at most hourly; this only picks up what it already holds.
const POLL_INTERVAL_MS = 15 * 60_000;
const isUserSurveyError = Schema.is(UserSurveyError);
const SEND_FAILED = "Could not send your answers. Check your connection and try again.";

export interface UserSurveyHandle {
  readonly survey: UserSurvey;
  readonly shown: () => void;
  readonly dismiss: () => void;
  readonly submit: SubmitUserSurvey;
  /** Drops the card once the thank-you is closed. */
  readonly finish: () => void;
}

/**
 * The survey this computer's server offers, from the primary environment only:
 * other environments are the same person's other servers.
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

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls the server for a newly launched survey
  useEffect(() => {
    if (!connected || environmentId === null) return;
    let current = true;
    const load = () =>
      void getSurvey({ environmentId, input: {} }).then((result) => {
        if (current && result._tag === "Success") setSurvey(result.value.survey);
      });
    load();
    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [connected, environmentId, getSurvey]);

  if (survey === null || environmentId === null || !canAnswer) return null;
  return {
    survey,
    shown: () => void report({ environmentId, input: { _tag: "Shown", surveyId: survey.id } }),
    dismiss: () => {
      setSurvey(null);
      void report({ environmentId, input: { _tag: "Dismissed", surveyId: survey.id } });
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
