import type {
  ComputerUseRuntimeSnapshot,
  ComputerUseSettingsInput,
  ComputerUseStateSnapshot,
} from "@upcomputer/computer-use-contracts/rpc";
import { CheckIcon, RotateCwIcon, XIcon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { Button } from "../../../../apps/web/src/components/ui/button.tsx";
import { Switch } from "../../../../apps/web/src/components/ui/switch.tsx";
import { Textarea } from "../../../../apps/web/src/components/ui/textarea.tsx";
import {
  Tooltip,
  TooltipPopup,
  TooltipTrigger,
} from "../../../../apps/web/src/components/ui/tooltip.tsx";
import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "../../../../apps/web/src/components/settings/settingsLayout.tsx";
import { cn } from "../../../../apps/web/src/lib/utils.ts";
import { readLocalApi } from "../../../../apps/web/src/localApi.ts";
import { parseLines, useComputerUseApi } from "./useComputerUseApi.ts";

const PERMISSIONS: Readonly<Record<string, { readonly label: string; readonly pane: string }>> = {
  accessibility: { label: "Accessibility", pane: "Privacy_Accessibility" },
  screenRecording: { label: "Screen Recording", pane: "Privacy_ScreenCapture" },
};

function openPrivacySettings(pane: string) {
  const url = `x-apple.systempreferences:com.apple.preference.security?${pane}`;
  void readLocalApi()?.shell.openExternal(url);
}

/**
 * Reads `Permissions: accessibility=granted, screenRecording=denied` from the
 * sidecar's doctor output; null when the output has another shape.
 */
function parsePermissions(message: string | undefined): ReadonlyArray<{
  readonly label: string;
  readonly pane: string;
  readonly granted: boolean;
}> | null {
  if (!message) return null;
  const matches = [...message.matchAll(/\b([a-zA-Z]+)=([a-zA-Z-]+)/g)].flatMap(([, key, value]) => {
    const permission = key ? PERMISSIONS[key] : undefined;
    return permission ? [{ ...permission, granted: value === "granted" }] : [];
  });
  return matches.length > 0 ? matches : null;
}

function statusSummary(computerUse: ComputerUseRuntimeSnapshot): {
  readonly tone: "muted" | "ok" | "busy" | "error";
  readonly text: string;
} {
  switch (computerUse.status) {
    case "disabled":
      return { tone: "muted", text: "Off" };
    case "stopped":
      return { tone: "ok", text: "Ready — starts when an agent needs it" };
    case "starting":
      return { tone: "busy", text: "Starting…" };
    case "ready":
      return { tone: "ok", text: "Running" };
    case "error":
      return { tone: "error", text: "Could not start" };
  }
}

const TONE_DOT: Record<ReturnType<typeof statusSummary>["tone"], string> = {
  muted: "bg-muted-foreground/40",
  ok: "bg-emerald-500",
  busy: "bg-sky-500",
  error: "bg-destructive",
};

function ComputerUseSettingsPage() {
  const api = useComputerUseApi();
  const [snapshot, setSnapshot] = useState<ComputerUseStateSnapshot>();
  const [allowedAppsDraft, setAllowedAppsDraft] = useState("");
  const [busyAction, setBusyAction] = useState<string>();
  const [error, setError] = useState<string>();

  const acceptSnapshot = useCallback((next: ComputerUseStateSnapshot) => {
    setSnapshot(next);
    setAllowedAppsDraft(next.computerUse.settings.allowedApps.join("\n"));
    setError(undefined);
  }, []);

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      acceptSnapshot(await api.snapshot());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [acceptSnapshot, api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runAction = useCallback(
    async (action: string, operation: () => Promise<ComputerUseStateSnapshot>) => {
      setBusyAction(action);
      setError(undefined);
      try {
        acceptSnapshot(await operation());
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusyAction(undefined);
      }
    },
    [acceptSnapshot],
  );

  const computerUse = snapshot?.computerUse;
  const settings = computerUse?.settings;
  const unavailable = !api;
  const busy = busyAction !== undefined;
  const updateSettings = useCallback(
    (patch: Partial<ComputerUseSettingsInput>) => {
      if (!api || !settings) return;
      void runAction("settings", () => api.updateComputerUseSettings({ ...settings, ...patch }));
    },
    [api, runAction, settings],
  );
  const checkPermissions = useCallback(() => {
    if (!api) return;
    void runAction("doctor", () => api.doctorComputerUse());
  }, [api, runAction]);
  const setEnabled = useCallback(
    (enabled: boolean) => {
      if (!api || !settings) return;
      void runAction("settings", async () => {
        const next = await api.updateComputerUseSettings({ ...settings, enabled });
        // Turning it on is when missing macOS permissions matter; check right away.
        return enabled ? api.doctorComputerUse() : next;
      });
    },
    [api, runAction, settings],
  );

  const permissions = parsePermissions(computerUse?.doctorMessage);
  const missingPermissions = permissions?.filter(({ granted }) => !granted) ?? [];
  const allowedAppsDirty =
    settings !== undefined &&
    parseLines(allowedAppsDraft).join("\n") !== settings.allowedApps.join("\n");

  // Check permissions once when the page opens with Computer Use on but never checked.
  const autoCheckedRef = useRef(false);
  useEffect(() => {
    if (autoCheckedRef.current || !computerUse?.settings.enabled || computerUse.checkedAt) return;
    autoCheckedRef.current = true;
    checkPermissions();
  }, [checkPermissions, computerUse]);

  // Coming back from System Settings: check again while something is missing.
  const recheckOnFocus = missingPermissions.length > 0 && !busy;
  useEffect(() => {
    if (!recheckOnFocus) return;
    window.addEventListener("focus", checkPermissions);
    return () => window.removeEventListener("focus", checkPermissions);
  }, [checkPermissions, recheckOnFocus]);

  let status: ReactNode;
  if (!computerUse) {
    status = unavailable
      ? "Connect to an environment to manage Computer Use."
      : "Loading Computer Use status…";
  } else {
    const summary = statusSummary(computerUse);
    const checking = busyAction === "doctor";
    // Before the first start no tools are known, so every required one reads as missing.
    const toolsMissing =
      (computerUse.status === "ready" || computerUse.tools.some((tool) => tool.available)) &&
      computerUse.missingRequiredTools.length > 0;
    status = (
      <span className="flex flex-col gap-1.5">
        <span className="flex items-center gap-1.5">
          <span className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[summary.tone])} />
          {summary.text}
        </span>
        {computerUse.status === "error" && computerUse.lastError ? (
          <span className="break-words text-destructive">
            {computerUse.lastError} It starts again on the next request.
          </span>
        ) : null}
        {toolsMissing ? (
          <span className="text-orange-600 dark:text-orange-300">
            This Open Computer Use version lacks {computerUse.missingRequiredTools.length} required
            tools. Update Up.computer.
          </span>
        ) : null}
        {computerUse.settings.enabled ? (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {permissions ? (
              permissions.map((permission) => (
                <span key={permission.pane} className="inline-flex items-center gap-1">
                  {permission.granted ? (
                    <CheckIcon className="size-3 text-emerald-500" />
                  ) : (
                    <XIcon className="size-3 text-orange-500" />
                  )}
                  {permission.label}
                  {permission.granted ? null : (
                    <Button
                      size="xs"
                      variant="outline"
                      className="ms-1"
                      onClick={() => openPrivacySettings(permission.pane)}
                    >
                      Open settings
                    </Button>
                  )}
                </span>
              ))
            ) : computerUse.doctorStatus && computerUse.doctorStatus !== "ok" ? (
              <span className="whitespace-pre-wrap text-orange-600 dark:text-orange-300">
                {computerUse.doctorMessage ?? "The permission check did not pass."}
              </span>
            ) : (
              <span>
                {checking ? "Checking macOS permissions…" : "macOS permissions not checked"}
              </span>
            )}
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label="Check permissions again"
                    className="inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
                    disabled={unavailable || busy}
                    onClick={checkPermissions}
                  />
                }
              >
                <RotateCwIcon className={cn("size-3", checking && "animate-spin")} />
              </TooltipTrigger>
              <TooltipPopup side="top">Check again</TooltipPopup>
            </Tooltip>
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <SettingsPageContainer>
      <SettingsSection title="Computer Use" hideTitle>
        <SettingsRow
          title="Native desktop access"
          description="Let agents see and use apps on this Mac."
          status={status}
          control={
            <Switch
              checked={settings?.enabled ?? false}
              disabled={unavailable || busy || !settings}
              aria-label="Enable Computer Use"
              onCheckedChange={(checked) => setEnabled(Boolean(checked))}
            />
          }
        />

        <SettingsRow
          title="Mode"
          description="Observe reads application state and screenshots. Control additionally permits clicking, typing, keys, scrolling, and dragging."
          control={
            <div className="grid grid-cols-2 overflow-hidden rounded-md border">
              {(["observe", "control"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  disabled={unavailable || busy || !settings}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium disabled:opacity-50",
                    settings?.mode === mode
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => updateSettings({ mode })}
                >
                  {mode === "observe" ? "Observe" : "Control"}
                </button>
              ))}
            </div>
          }
        />

        <SettingsRow
          title="Action approvals"
          description="Always ask before native control actions execute, even when the thread otherwise has full access. Agents that cannot ask for approval are refused control actions while this is on."
          control={
            <Switch
              checked={settings?.requireActionApproval ?? true}
              disabled={unavailable || busy || !settings}
              aria-label="Require Computer Use approvals"
              onCheckedChange={(checked) =>
                updateSettings({ requireActionApproval: Boolean(checked) })
              }
            />
          }
        />

        <SettingsRow
          title="Allowed applications"
          description="Only these apps, one per line, exactly as named. Leave empty to allow visible apps except protected credential surfaces."
        >
          <div className="mt-3 space-y-3 pb-4">
            <Textarea
              value={allowedAppsDraft}
              onChange={(event) => setAllowedAppsDraft(event.currentTarget.value)}
              placeholder={"Xcode\nSimulator\nGoogle Chrome"}
              className="min-h-28 resize-y font-mono text-xs"
              disabled={unavailable}
            />
            {allowedAppsDirty ? (
              <div className="flex justify-end">
                <Button
                  size="sm"
                  disabled={unavailable || busy}
                  onClick={() => updateSettings({ allowedApps: parseLines(allowedAppsDraft) })}
                >
                  Save applications
                </Button>
              </div>
            ) : null}
          </div>
        </SettingsRow>

        <SettingsRow
          title="Coordinate fallback"
          description="Allow raw x/y targeting when a stable element index is unavailable. Off by default because element targeting is safer."
          control={
            <Switch
              checked={settings?.allowCoordinateFallback ?? false}
              disabled={unavailable || busy || !settings}
              aria-label="Allow coordinate fallback"
              onCheckedChange={(checked) =>
                updateSettings({ allowCoordinateFallback: Boolean(checked) })
              }
            />
          }
        />
      </SettingsSection>

      {error ? <p className="px-3 text-xs text-destructive sm:px-4">{error}</p> : null}
    </SettingsPageContainer>
  );
}

export default ComputerUseSettingsPage;
