import type { ComponentProps } from "react";

import { WelcomeWizard } from "../components/onboarding/WelcomeWizard";
import { usePrimaryEnvironment } from "../state/environments";
import { UpComputerOnboarding } from "./UpComputerOnboarding";
import { showsUpComputerOnboarding } from "./upComputerOnboarding.logic";

/** The `/welcome` route's setup: the `onboarding` surface's screens or upstream's wizard. */
export function FirstRunSetup(props: ComponentProps<typeof WelcomeWizard>) {
  const primaryEnvironment = usePrimaryEnvironment();
  const environmentId = props.resumeEnvironmentId ?? primaryEnvironment?.environmentId;
  if (
    environmentId === undefined ||
    !showsUpComputerOnboarding({ localAvailable: props.localAvailable, environmentId })
  ) {
    return <WelcomeWizard {...props} />;
  }
  return (
    <UpComputerOnboarding
      environmentId={environmentId}
      resumeCodexSetup={props.resumeEnvironmentId !== undefined}
      onDone={props.onDone}
    />
  );
}
