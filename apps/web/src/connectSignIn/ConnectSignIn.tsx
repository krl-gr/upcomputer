import { useAuth } from "@clerk/react";
import { useAtomValue } from "@effect/atom-react";
import {
  AuthRelayReadScope,
  AuthRelayWriteScope,
  type AuthSessionState,
  type EnvironmentId,
  managedCapabilityDenial,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { AsyncResult, Atom } from "effect/reactivity";
import { useEffect, useEffectEvent, useState } from "react";

import { hasCloudPublicConfig } from "../cloud/publicConfig";
import { useCloudLinkController } from "../cloud/useCloudLinkController";
import {
  CloudEnvironmentConnectRows,
  type SavedCloudEnvironmentConnection,
} from "../components/cloud/CloudEnvironmentConnectList";
import { ConnectOnboardingDialog } from "../components/cloud/ConnectOnboardingDialog";
import { toastManager } from "../components/ui/toast";
import { isElectron } from "../env";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { usePrimaryManagedPolicy } from "../state/managedPolicy";
import { environmentSession, useEnvironmentScope } from "../state/session";
import {
  NO_SIGN_IN_REQUESTS,
  nextSignInRequests,
  observedClerkAccount,
  signInPublishStep,
} from "./connectSignIn.logic";

/**
 * Replaces upstream's Connect onboarding dialog (the `connectOnboarding`
 * surface). The desktop app sets Connect up on a fresh sign-in by itself; web
 * clients, including the hosted app, keep upstream's dialog.
 */
export function ConnectSignIn() {
  if (!isElectron) return <ConnectOnboardingDialog />;
  if (!hasCloudPublicConfig()) return null;
  return <DesktopConnectSignIn />;
}

const EMPTY_SESSION_STATE_ATOM = Atom.make(AsyncResult.initial<AuthSessionState>());

function DesktopConnectSignIn() {
  // Pending Clerk sessions must not look signed out or activation would look like a new sign-in.
  const { isLoaded, isSignedIn, userId } = useAuth({ treatPendingAsSignedOut: false });
  const navigate = useNavigate();
  const { environments, isReady: environmentsReady } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const primarySessionState = useAtomValue(
    primaryEnvironmentId === null
      ? EMPTY_SESSION_STATE_ATOM
      : environmentSession.sessionStateAtom(primaryEnvironmentId),
  );
  const canReadRelay = useEnvironmentScope(primaryEnvironmentId, AuthRelayReadScope);
  const canWriteRelay = useEnvironmentScope(primaryEnvironmentId, AuthRelayWriteScope);
  const connectAllowed =
    managedCapabilityDenial(usePrimaryManagedPolicy(), "connect") === undefined;
  const controller = useCloudLinkController(primaryEnvironmentId);

  const [requests, setRequests] = useState(NO_SIGN_IN_REQUESTS);
  const [publishFailedFor, setPublishFailedFor] = useState<string | null>(null);

  const account = observedClerkAccount({ isLoaded, isSignedIn, userId });
  const nextRequests = nextSignInRequests(requests, account);
  if (nextRequests !== requests) setRequests(nextRequests);
  const { publishFor, addingFor } = nextRequests;
  if (account !== undefined && publishFailedFor !== null && publishFailedFor !== account) {
    setPublishFailedFor(null);
  }

  const step =
    publishFor === null
      ? null
      : signInPublishStep({
          account: publishFor,
          scopesKnown:
            primaryEnvironmentId === null
              ? environmentsReady
              : primarySessionState._tag !== "Initial",
          canManageRelay: canReadRelay && canWriteRelay && connectAllowed,
          hasTarget: controller.linkState.target !== null,
          linkState: controller.linkState,
        });
  if (step === "skip") setRequests({ ...nextRequests, publishFor: null });

  // The dialog's defaults: this environment and its agent activity.
  const publish = useEffectEvent(async (forAccount: string) => {
    const ok = await controller.reconcileCloudState({ managedTunnel: true, publish: true });
    if (!ok) {
      setPublishFailedFor(forAccount);
      return;
    }
    toastManager.add({
      type: "success",
      title: "UpComputer Connect is on",
      description:
        "Your other devices can reach this computer. Turn it off in Settings, Sharing & access.",
    });
  });
  const reportOtherAccount = useEffectEvent(() => {
    toastManager.add({
      type: "warning",
      title: "This computer is on another UpComputer Connect account",
      description:
        "To move it to this account, turn UpComputer Connect off and on again in Settings, Sharing & access.",
      timeout: 0,
      actionProps: {
        children: "Open Sharing & access",
        onClick: () => void navigate({ to: "/settings/access" }),
      },
      data: { actionLayout: "stacked-end" },
    });
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- links this environment on the relay once the sign-in's publish step is decided
  useEffect(() => {
    if ((step !== "publish" && step !== "other-account") || publishFor === null) return;
    // oxlint-disable-next-line react/set-state-in-effect -- Clearing the request as the publish starts keeps a later render from starting it again.
    setRequests((current) => ({ ...current, publishFor: null }));
    if (step === "publish") void publish(publishFor);
    else reportOtherAccount();
  }, [step, publishFor]);

  // Other failures already toast from the controller; the tunnel cap is left to its caller.
  const tunnelLimit = publishFailedFor === null ? null : controller.tunnelLimit;
  const reportTunnelLimit = useEffectEvent((limit: number) => {
    setPublishFailedFor(null);
    toastManager.add({
      type: "warning",
      title: "This computer is not on UpComputer Connect",
      description: `Your account already has ${limit} computers on UpComputer Connect, its limit. Remove one you no longer use, then turn it on in Settings, Sharing & access.`,
      timeout: 0,
      actionProps: {
        children: "Open Sharing & access",
        onClick: () => void navigate({ to: "/settings/access" }),
      },
      data: { actionLayout: "stacked-end" },
    });
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the controller reports the tunnel cap as state after its publish call returns
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- The warning toast shows once, so reporting it clears the failed publish.
    if (tunnelLimit !== null) reportTunnelLimit(tunnelLimit);
  }, [tunnelLimit]);

  return addingFor === null ? null : (
    <AddAccountComputers
      key={addingFor}
      primaryEnvironmentId={primaryEnvironmentId}
      savedEnvironments={environments}
    />
  );
}

/**
 * Adds the account's other compatible computers through the hosted app's
 * auto-selection (`autoSelectedComputers`), mounted without its rows: each
 * added computer reports itself in a toast and then shows under Computers.
 */
function AddAccountComputers({
  primaryEnvironmentId,
  savedEnvironments,
}: {
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly savedEnvironments: ReadonlyArray<SavedCloudEnvironmentConnection>;
}) {
  const [autoSelectedComputers] = useState(() => new Set<EnvironmentId>());
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<EnvironmentId>>(() => new Set());
  return (
    <div hidden>
      <CloudEnvironmentConnectRows
        primaryEnvironmentId={primaryEnvironmentId}
        savedEnvironments={savedEnvironments}
        selection={{
          autoSelectedComputers,
          selectedIds,
          onChange: (environmentId, selected) =>
            setSelectedIds((ids) => {
              const next = new Set(ids);
              if (selected) next.add(environmentId);
              else next.delete(environmentId);
              return next;
            }),
        }}
      />
    </div>
  );
}
