import type {
  ComputerUseRuntimeSnapshot,
  ComputerUseSettingsInput,
  ComputerUseStateSnapshot,
} from "@t3tools/computer-use-contracts/rpc";
import { CheckIcon, RotateCwIcon, XIcon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { msg, T, useGT, useMessages } from "gt-react";

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

const PERMISSIONS: Readonly<
  Record<string, { readonly label: string; readonly pane: "accessibility" | "screen-recording" }>
> = {
  accessibility: {
    label: msg("Accessibility", { $context: "macOS privacy permission name" }),
    pane: "accessibility",
  },
  screenRecording: {
    label: msg("Screen Recording", { $context: "macOS privacy permission name" }),
    pane: "screen-recording",
  },
};

/** Only the desktop app can open System Settings; elsewhere the button does nothing. */
function openPrivacySettings(pane: "accessibility" | "screen-recording") {
  void readLocalApi()
    ?.shell.openSystemSettings(pane)
    .catch(() => undefined);
}

/**
 * Reads `Permissions: accessibility=granted, screenRecording=denied` from the
 * sidecar's doctor output; null when the output has another shape.
 */
function parsePermissions(message: string | undefined): ReadonlyArray<{
  readonly label: string;
  readonly pane: "accessibility" | "screen-recording";
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
      return { tone: "muted", text: msg("Off", { $context: "Computer Use status" }) };
    case "stopped":
      return { tone: "ok", text: msg("Ready, starts when an agent needs it") };
    case "starting":
      return { tone: "busy", text: msg("Starting…") };
    case "ready":
      return { tone: "ok", text: msg("Running", { $context: "Computer Use status" }) };
    case "error":
      return { tone: "error", text: msg("Could not start") };
  }
}

const TONE_DOT: Record<ReturnType<typeof statusSummary>["tone"], string> = {
  muted: "bg-muted-foreground/40",
  ok: "bg-emerald-500",
  busy: "bg-sky-500",
  error: "bg-destructive",
};

function ComputerUseSettingsPage() {
  const gt = useGT();
  const m = useMessages();
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
  // The helper's doctor also opens its own permission window while anything is
  // missing, so it runs only on an explicit action, never on page open or focus.
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
  const allowedAppsDirty =
    settings !== undefined &&
    parseLines(allowedAppsDraft).join("\n") !== settings.allowedApps.join("\n");

  let status: ReactNode;
  if (!computerUse) {
    status = unavailable
      ? gt("Connect to an environment to manage Computer Use.")
      : gt("Loading Computer Use status…");
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
          {m(summary.text)}
        </span>
        {computerUse.status === "error" && computerUse.lastError ? (
          <span className="break-words text-destructive">
            {gt("{error} It starts again on the next request.", {
              error: computerUse.lastError,
            })}
          </span>
        ) : null}
        {toolsMissing ? (
          <span className="text-orange-600 dark:text-orange-300">
            {gt(
              "This Open Computer Use version lacks {count, plural, one {# required tool} other {# required tools}}. Update Up.computer.",
              { count: computerUse.missingRequiredTools.length },
            )}
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
                  {m(permission.label)}
                  {permission.granted ? null : (
                    <Button
                      size="xs"
                      variant="outline"
                      className="ms-1"
                      onClick={() => openPrivacySettings(permission.pane)}
                    >
                      <T>Open settings</T>
                    </Button>
                  )}
                </span>
              ))
            ) : computerUse.doctorStatus && computerUse.doctorStatus !== "ok" ? (
              <span className="whitespace-pre-wrap text-orange-600 dark:text-orange-300">
                {computerUse.doctorMessage ?? gt("The permission check did not pass.")}
              </span>
            ) : checking ? (
              <span>
                <T>Checking macOS permissions…</T>
              </span>
            ) : (
              <Button
                size="xs"
                variant="outline"
                disabled={unavailable || busy}
                onClick={checkPermissions}
              >
                <T>Check macOS permissions</T>
              </Button>
            )}
            {computerUse.checkedAt ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label={gt("Check permissions again")}
                      className="inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
                      disabled={unavailable || busy}
                      onClick={checkPermissions}
                    />
                  }
                >
                  <RotateCwIcon className={cn("size-3", checking && "animate-spin")} />
                </TooltipTrigger>
                <TooltipPopup side="top">
                  <T>Check again</T>
                </TooltipPopup>
              </Tooltip>
            ) : null}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <SettingsPageContainer>
      <SettingsSection title={gt("Computer Use")} hideTitle>
        <SettingsRow
          title={gt("Native desktop access")}
          description={<T>Let agents see and use apps on this Mac.</T>}
          status={status}
          control={
            <Switch
              checked={settings?.enabled ?? false}
              disabled={unavailable || busy || !settings}
              aria-label={gt("Enable Computer Use")}
              onCheckedChange={(checked) => setEnabled(Boolean(checked))}
            />
          }
        />

        <SettingsRow
          title={gt("Mode", { $context: "Computer Use mode: observe or control" })}
          description={
            <T>
              Observe reads application state and screenshots. Control additionally permits
              clicking, typing, keys, scrolling, and dragging.
            </T>
          }
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
                  {mode === "observe"
                    ? gt("Observe", { $context: "Computer Use mode that only reads the screen" })
                    : gt("Control", { $context: "Computer Use mode that can also click and type" })}
                </button>
              ))}
            </div>
          }
        />

        <SettingsRow
          title={gt("Action approvals")}
          description={
            <T>
              Always ask before native control actions execute, even when the thread otherwise has
              full access. Agents that cannot ask for approval are refused control actions while
              this is on.
            </T>
          }
          control={
            <Switch
              checked={settings?.requireActionApproval ?? false}
              disabled={unavailable || busy || !settings}
              aria-label={gt("Require Computer Use approvals")}
              onCheckedChange={(checked) =>
                updateSettings({ requireActionApproval: Boolean(checked) })
              }
            />
          }
        />

        <SettingsRow
          title={gt("Allowed applications")}
          description={
            <T>
              Only these apps, one per line, exactly as named. Leave empty to allow visible apps
              except protected credential surfaces.
            </T>
          }
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
                  <T>Save applications</T>
                </Button>
              </div>
            ) : null}
          </div>
        </SettingsRow>

        <SettingsRow
          title={gt("Coordinate fallback")}
          description={
            <T>
              Allow raw x/y targeting when a stable element index is unavailable. Off by default
              because element targeting is safer.
            </T>
          }
          control={
            <Switch
              checked={settings?.allowCoordinateFallback ?? false}
              disabled={unavailable || busy || !settings}
              aria-label={gt("Allow coordinate fallback")}
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
