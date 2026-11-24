import { useAtomValue } from "@effect/atom-react";
import {
  AuthProvidersManageScope,
  AuthTerminalOperateScope,
  type EnvironmentId,
  ProviderInstanceId,
  type ThreadId,
} from "@t3tools/contracts";
import { providerSignInInstanceId } from "@t3tools/shared/providerSignIn";
import { T, useGT } from "gt-react";
import { use, useEffect, useRef } from "react";

import { useEnvironment } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { terminalEnvironment } from "../../state/terminal";
import { useKnownTerminalSessions } from "../../state/terminalSessions";
import { useAtomCommand } from "../../state/use-atom-command";
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
  return row.surface.kind === "terminal" ? (
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
        onSessionExited={() => undefined}
        status={
          canOperateTerminal
            ? gt("Review the command, then press Enter to run it.")
            : gt("This connection cannot control terminals.")
        }
        actions={
          <Button
            size="xs"
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
  if (provider === undefined || provider.auth.status === "authenticated") return null;
  const config = serverConfig?.settings.providerInstances[instanceId]?.config;
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
          onEnable={() => undefined}
        />
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
