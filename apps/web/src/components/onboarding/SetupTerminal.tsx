import type {
  EnvironmentId,
  ProviderInstanceId,
  ResolvedKeybindingsConfig,
  ThreadId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import * as Schema from "effect/Schema";
import type { ReactNode } from "react";

import { TYPOGRAPHY_ADVANCED_STORAGE_KEY } from "../../appearanceFonts";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { TerminalViewport } from "../ThreadTerminalDrawer";

export interface SetupTerminalSession {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly terminalId: string;
  readonly cwd: string;
  readonly providerInstanceId?: ProviderInstanceId;
  readonly label: string;
  readonly keybindings: ResolvedKeybindingsConfig;
}

/**
 * The terminal that installs or signs in an agent: a status line with actions over a
 * terminal with the command typed in. Shared by the Welcome page and the chat card the
 * `provider_sign_in` tool opens.
 */
export function SetupTerminal({
  session,
  status,
  actions,
  showTerminal,
  onSessionExited,
  autoFocus = true,
}: {
  readonly session: SetupTerminalSession;
  readonly status: ReactNode;
  readonly actions: ReactNode;
  /** False until the terminal exists, so the viewport does not open one of its own. */
  readonly showTerminal: boolean;
  readonly onSessionExited: () => void;
  /** Off where the card can remount, as in the virtualized chat, so it never takes focus back. */
  readonly autoFocus?: boolean;
}) {
  const [advancedTypography] = useLocalStorage(
    TYPOGRAPHY_ADVANCED_STORAGE_KEY,
    false,
    Schema.Boolean,
  );
  return (
    <div
      data-thread-terminal-drawer
      className="mt-4 overflow-hidden rounded-lg border border-border/70 bg-background text-foreground"
    >
      <div className="flex items-center justify-between border-b border-border/60 bg-background/60 px-3 py-1.5">
        <span className="text-2xs font-medium text-muted-foreground">{status}</span>
        <div className="flex items-center gap-1">{actions}</div>
      </div>
      <div className="h-64">
        {showTerminal ? (
          <TerminalViewport
            threadRef={scopeThreadRef(session.environmentId, session.threadId)}
            threadId={session.threadId}
            terminalId={session.terminalId}
            terminalLabel={session.label}
            cwd={session.cwd}
            {...(session.providerInstanceId === undefined
              ? {}
              : { providerInstanceId: session.providerInstanceId })}
            advancedTypography={advancedTypography}
            onSessionExited={onSessionExited}
            autoFocus={autoFocus}
            visible
            keybindings={session.keybindings}
          />
        ) : null}
      </div>
    </div>
  );
}
