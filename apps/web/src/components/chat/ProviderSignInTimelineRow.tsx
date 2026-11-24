import { useAtomValue } from "@effect/atom-react";
import {
  AuthProvidersManageScope,
  AuthTerminalOperateScope,
  type EnvironmentId,
  ProviderInstanceId,
  type ThreadId,
} from "@t3tools/contracts";
import { providerSignInInstanceId } from "@t3tools/shared/providerSignIn";
import { resolveProviderInstanceDisplayName } from "@t3tools/client-runtime/state/provider-instance-display";
import { T, useGT } from "gt-react";
import { use, useEffect, useRef } from "react";

import { useEnvironment } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { terminalEnvironment } from "../../state/terminal";
import { useKnownTerminalSessions } from "../../state/terminalSessions";
import { useAtomCommand } from "../../state/use-atom-command";
import { usePersistEnvironmentProviderInstanceMutation } from "../../hooks/useSettings";
import { turnedOnInstance } from "../../onboarding/welcomePage.logic";
import { SwitchChatToSignedInAgent } from "../../onboardingSurface/SwitchChatToSignedInAgent";
import { SetupTerminal } from "../onboarding/SetupTerminal";
import { ProviderAuthenticationSection } from "../settings/ProviderAuthenticationSection";
import { readAntigravityAuthMethod, ProviderSetupSection } from "../settings/ProviderSetupSection";
import { Button } from "../ui/button";
import { TimelineRowCtx, type TimelineRow } from "./timelineRowContext";

type ProviderSignInRow = Extract<TimelineRow, { kind: "provider-sign-in" }>;

/** What `provider_sign_in` showed the user, under the agent's call, until it is done. */
export function ProviderSignInTimelineRow({ row }: { row: ProviderSignInRow }) {
  const ctx = use(TimelineRowCtx);
  const environmentId = ctx.threadRef?.environmentId ?? ctx.activeThreadEnvironmentId;
  const instanceId =
    row.surface.kind === "terminal"
      ? providerSignInInstanceId(row.surface.terminalId)
      : row.surface.instanceId;
  return (
    <>
      {row.surface.kind === "terminal" ? (
        <SignInTerminal
          environmentId={environmentId}
          threadId={row.sourceThreadId}
          terminalId={row.surface.terminalId}
        />
      ) : (
        <AppSetup
          environmentId={environmentId}
          instanceId={ProviderInstanceId.make(row.surface.instanceId)}
        />
      )}
      {instanceId === null ? null : (
        <SwitchChatToSignedInAgent
          environmentId={environmentId}
          threadId={row.sourceThreadId}
          instanceId={ProviderInstanceId.make(instanceId)}
        />
      )}
    </>
  );
}

/** The terminal the server opened with the sign-in command typed in, while it is open. */
function SignInTerminal({
  environmentId,
  threadId,
  terminalId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly terminalId: string;
}) {
  const gt = useGT();
  const session = useKnownTerminalSessions({ environmentId, threadId })?.find(
    (candidate) => candidate.target.terminalId === terminalId,
  );
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const canOperateTerminal = useEnvironmentScope(environmentId, AuthTerminalOperateScope);
  const closeTerminal = useAtomCommand(terminalEnvironment.close, { reportFailure: false });
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const instanceId = providerSignInInstanceId(terminalId);
  const running = session?.state.hasRunningSubprocess ?? false;
  const startedRef = useRef(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the shell stays open after sign-in, so its command exiting is the only signal to check the provider again
  useEffect(() => {
    if (running) {
      startedRef.current = true;
    } else if (startedRef.current && instanceId !== null) {
      startedRef.current = false;
      void refreshProviders({
        environmentId,
        input: { instanceId: ProviderInstanceId.make(instanceId) },
      });
    }
  }, [environmentId, instanceId, refreshProviders, running]);

  if (session === undefined || serverConfig === null) return null;
  return (
    <div className="min-w-0 px-1">
      <SetupTerminal
        session={{
          environmentId,
          threadId,
          terminalId,
          cwd: session.state.summary?.cwd ?? serverConfig.cwd,
          ...(instanceId === null
            ? {}
            : { providerInstanceId: ProviderInstanceId.make(instanceId) }),
          label: gt("Sign in"),
          keybindings: serverConfig.keybindings,
        }}
        showTerminal
        autoFocus={false}
        textSize="chat"
        onSessionExited={() => undefined}
        status={
          canOperateTerminal
            ? gt("Review the command, then press Enter to run it.")
            : gt("This connection cannot control terminals.")
        }
        actions={
          <Button
            size="sm"
            variant="ghost-muted"
            disabled={!canOperateTerminal}
            onClick={() =>
              void closeTerminal({
                environmentId,
                input: { threadId, terminalId, deleteHistory: true },
              })
            }
          >
            <T>Close</T>
          </Button>
        }
      />
    </div>
  );
}

/**
 * The app's own install and sign-in for a provider that has them, as Settings shows them,
 * until the provider is signed in. The sign-in flow belongs to this client's session.
 */
function AppSetup({
  environmentId,
  instanceId,
}: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
}) {
  const provider = useAtomValue(serverEnvironment.providersValueAtom(environmentId))?.find(
    (candidate) => candidate.instanceId === instanceId,
  );
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const environmentLabel = useEnvironment(environmentId)?.label ?? "";
  const canManageProviders = useEnvironmentScope(environmentId, AuthProvidersManageScope);
  const persistProviderInstance = usePersistEnvironmentProviderInstanceMutation(environmentId);
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  if (provider === undefined || (provider.enabled && provider.auth.status === "authenticated")) {
    return null;
  }
  const config = serverConfig?.settings.providerInstances[instanceId]?.config;
  // A new user's Antigravity or Cursor starts turned off; the card turns it on, as Welcome does.
  const turnOn = async () => {
    const instance = serverConfig?.settings.providerInstances[instanceId] ?? {
      driver: provider.driver,
    };
    const result = await persistProviderInstance({
      operation: "upsert",
      instanceId,
      instance: turnedOnInstance(instance),
    });
    if (result._tag === "Success") void refreshProviders({ environmentId, input: { instanceId } });
  };
  return (
    <div className="mt-4 min-w-0 overflow-hidden rounded-lg border border-border/70 px-1">
      {provider.driver === "antigravity" ? (
        <ProviderSetupSection
          environmentId={environmentId}
          environmentLabel={environmentLabel}
          instanceId={instanceId}
          provider={provider}
          binaryPath={
            config !== null &&
            typeof config === "object" &&
            "binaryPath" in config &&
            typeof config.binaryPath === "string"
              ? config.binaryPath
              : undefined
          }
          authMethod={readAntigravityAuthMethod(config)}
          enabled={provider.enabled}
          readOnly={!canManageProviders}
          onEnable={() => void turnOn()}
        />
      ) : !provider.enabled ? (
        <div className="flex items-center justify-between gap-3 px-2 py-2">
          <span className="text-muted-foreground">
            {resolveProviderInstanceDisplayName(provider)}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={!canManageProviders}
            onClick={() => void turnOn()}
          >
            <T>Turn on</T>
          </Button>
        </div>
      ) : (
        <ProviderAuthenticationSection
          environmentId={environmentId}
          environmentLabel={environmentLabel}
          instanceId={instanceId}
          provider={provider}
          readOnly={!canManageProviders}
        />
      )}
    </div>
  );
}
