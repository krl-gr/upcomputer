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
  freshSignIn,
  type ObservedAccount,
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

  const [observed, setObserved] = useState<ObservedAccount>(undefined);
  const [publishFor, setPublishFor] = useState<string | null>(null);
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [publishFailedFor, setPublishFailedFor] = useState<string | null>(null);

  const account = observedClerkAccount({ isLoaded, isSignedIn, userId });
  if (account !== undefined && account !== observed) {
    setObserved(account);
    const fresh = freshSignIn(observed, account);
    if (fresh !== null) {
      setPublishFor(fresh);
      setAddingFor(fresh);
      setPublishFailedFor(null);
    }
  }
  const current = account ?? null;
  if (publishFor !== null && publishFor !== current) setPublishFor(null);
  if (addingFor !== null && addingFor !== current) setAddingFor(null);
  if (publishFailedFor !== null && publishFailedFor !== current) setPublishFailedFor(null);

  const step =
    publishFor === null
      ? null
      : signInPublishStep({
          scopesKnown:
            primaryEnvironmentId === null
              ? environmentsReady
              : primarySessionState._tag !== "Initial",
          canManageRelay: canReadRelay && canWriteRelay && connectAllowed,
          hasTarget: controller.linkState.target !== null,
          linkStateKnown: controller.linkState.data !== null || controller.linkState.error !== null,
        });
  if (step === "skip") setPublishFor(null);

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
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- links this environment on the relay once the sign-in's publish step is decided
  useEffect(() => {
    if (step !== "publish" || publishFor === null) return;
    // oxlint-disable-next-line react/set-state-in-effect -- Clearing the request as the publish starts keeps a later render from starting it again.
    setPublishFor(null);
    void publish(publishFor);
  }, [step, publishFor]);

  // Other failures already toast from the controller; the tunnel cap is left to its caller.
  const tunnelLimit = publishFailedFor === null ? null : controller.tunnelLimit;
  const reportTunnelLimit = useEffectEvent((limit: number) => {
    setPublishFailedFor(null);
    toastManager.add({
      type: "warning",
      title: "This computer is not on UpComputer Connect",
      description: `Your account already has ${limit} computers on UpComputer Connect, the most it allows. Remove one you no longer use, then turn UpComputer Connect on in Settings, Sharing & access.`,
      timeout: 0,
      actionProps: {
        children: "Open Sharing & access",
        onClick: () => void navigate({ to: "/settings/access" }),
      },
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
