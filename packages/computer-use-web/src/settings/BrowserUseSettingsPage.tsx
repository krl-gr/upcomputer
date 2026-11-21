import type {
  BrowserForAgents,
  ComputerUseStateSnapshot,
} from "@t3tools/computer-use-contracts/rpc";
import { Globe2Icon, RotateCcwIcon, SquareIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { T, useGT } from "gt-react";

import { Button } from "../../../../apps/web/src/components/ui/button.tsx";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../../../apps/web/src/components/ui/select.tsx";
import { Textarea } from "../../../../apps/web/src/components/ui/textarea.tsx";
import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "../../../../apps/web/src/components/settings/settingsLayout.tsx";
import { useComputerUseApi } from "./useComputerUseApi.ts";

function BrowserUseSettingsPage() {
  const gt = useGT();
  const api = useComputerUseApi();
  const [snapshot, setSnapshot] = useState<ComputerUseStateSnapshot>();
  const [loginUrl, setLoginUrl] = useState("");
  const [busyAction, setBusyAction] = useState<string>();
  const [error, setError] = useState<string>();

  const acceptSnapshot = useCallback((next: ComputerUseStateSnapshot) => {
    setSnapshot(next);
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

  const browser = snapshot?.browser;
  const unavailable = !api;
  const browserForAgents: BrowserForAgents =
    browser?.browserForAgents ?? (browser?.alwaysUseChrome ? "chrome" : "builtin");
  const choices: Record<BrowserForAgents, { label: string; description: string }> = {
    automatic: {
      label: gt("Automatic"),
      description: gt(
        "Workers and delegated tasks use Chrome, so they keep working while the screen is off or locked. In chats, agents use the built-in browser, where you can watch, take over, record and pick elements.",
      ),
    },
    chrome: {
      label: gt("Always Chrome"),
      description: gt(
        "Every agent uses Chrome, including in chats. Use it for sites that reject embedded browsers, such as Google sign-in or passkeys. Chrome tabs do not appear in the browser panel.",
      ),
    },
    builtin: {
      label: gt("Always built-in browser"),
      description: gt(
        "Agents use the desktop app's browser. On Windows, background work can stall while the screen is off.",
      ),
    },
  };
  const chromeUnavailable =
    browser?.installed === false
      ? gt("Chrome or Edge is not installed, so agents use the built-in browser.")
      : browser?.launchError
        ? gt("Chrome did not start, so agents use the built-in browser for now: {reason}", {
            reason: browser.launchError,
          })
        : undefined;
  return (
    <SettingsPageContainer>
      <SettingsSection title={gt("Browser Use")} hideTitle>
        <SettingsRow
          title={gt("Browser for agents")}
          description={choices[browserForAgents].description}
          status={chromeUnavailable}
          control={
            <Select
              value={browserForAgents}
              disabled={unavailable || busyAction !== undefined || !snapshot}
              onValueChange={(value) => {
                if (value === "automatic" || value === "chrome" || value === "builtin") {
                  void runAction("host", () =>
                    api!.updateBrowserSettings({ browserForAgents: value }),
                  );
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-48"
                aria-label={gt("Browser for agents")}
              >
                <SelectValue>{choices[browserForAgents].label}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {(["automatic", "chrome", "builtin"] as const).map((choice) => (
                  <SelectItem hideIndicator key={choice} value={choice}>
                    {choices[choice].label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          title={gt("Isolated browser profile")}
          description={
            <T>
              Up controls an installed Chrome or Edge through a dedicated persistent profile. Your
              everyday browser profile is never reused.
            </T>
          }
          status={
            browser
              ? `${browser.status === "open" ? gt("Browser open") : gt("Browser closed")}${browser.browserName ? ` · ${browser.browserName === "msedge" ? "Microsoft Edge" : "Google Chrome"}` : ""}`
              : unavailable
                ? gt("Connect to an environment to manage Browser Use.")
                : gt("Loading browser status…")
          }
          control={
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={unavailable || busyAction !== undefined}
                onClick={() => void runAction("open", () => api!.openBrowser(loginUrl.trim()))}
              >
                <Globe2Icon /> <T>Open browser</T>
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={gt("Refresh browser status")}
                disabled={unavailable || busyAction !== undefined}
                onClick={() => void refresh()}
              >
                <RotateCcwIcon />
              </Button>
            </div>
          }
        >
          <div className="mt-3 space-y-2 pb-4">
            <Textarea
              value={loginUrl}
              onChange={(event) => setLoginUrl(event.currentTarget.value)}
              placeholder={gt("Optional login URL, for example https://github.com/login")}
              className="min-h-10 resize-none font-mono text-xs"
            />
            {browser?.currentUrl ? (
              <p className="break-all text-[11px] text-muted-foreground">
                {gt("Current page: {title} · {url}", {
                  title: browser.currentTitle ?? browser.currentUrl,
                  url: browser.currentUrl,
                })}
              </p>
            ) : null}
            {browser?.profilePath ? (
              <p className="break-all text-[11px] text-muted-foreground">
                {gt("Profile: {path}", { path: browser.profilePath })}
              </p>
            ) : null}
          </div>
        </SettingsRow>

        <SettingsRow
          title={gt("Session controls")}
          description={
            <T>
              Close the managed browser process or permanently clear cookies and other data from the
              isolated profile.
            </T>
          }
          control={
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={unavailable || busyAction !== undefined || browser?.status !== "open"}
                onClick={() => void runAction("close", () => api!.closeBrowser())}
              >
                <SquareIcon /> <T context="button that closes the managed browser">Close</T>
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={unavailable || busyAction !== undefined}
                onClick={() => {
                  if (
                    !window.confirm(
                      gt("Clear the isolated Up browser profile and all saved logins?"),
                    )
                  ) {
                    return;
                  }
                  void runAction("clear", () => api!.clearBrowserProfile());
                }}
              >
                <Trash2Icon /> <T>Clear browser data</T>
              </Button>
            </div>
          }
        />
      </SettingsSection>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </SettingsPageContainer>
  );
}

export default BrowserUseSettingsPage;
