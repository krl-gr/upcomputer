import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import { NoAgentScreen, type NoAgentScreenView } from "./NoAgentScreen";

/*
 * Design preview, dev builds only: stands in for "no coding agent on this Mac".
 * Set localStorage "upcomputer:dev:no-agent-screen" to "offer" and reload, then
 * switch states with window.noAgentScreenPreview("installing", 0.42).
 */
const STORAGE_KEY = "upcomputer:dev:no-agent-screen";
const STATES = [
  "offer",
  "installing",
  "starting",
  "slow",
  "failed",
  "retrying",
  "copied",
  "closed",
] as const;
type PreviewState = (typeof STATES)[number];

declare global {
  interface Window {
    noAgentScreenPreview?: (state: PreviewState, progress?: number) => void;
  }
}

function readRequestedState(): PreviewState | null {
  if (!import.meta.env.DEV || typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return STATES.find((state) => state === stored) ?? null;
  } catch {
    return null;
  }
}

const requestedState = readRequestedState();

export function noAgentScreenPreviewRequested(): boolean {
  return requestedState !== null;
}

const FAILED_MESSAGE =
  "Could not start setting up your agent. Check your connection and try again.";

export function NoAgentScreenPreview({ children }: { readonly children: ReactNode }) {
  const navigate = useNavigate();
  const [preview, setPreview] = useState<{
    readonly state: PreviewState;
    readonly progress: number;
    /** A click in the preview runs a short fake download; a console call holds still. */
    readonly running: boolean;
  }>({ state: requestedState ?? "offer", progress: 0.42, running: false });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the console switch on window while mounted
  useEffect(() => {
    window.noAgentScreenPreview = (state, progress = 0.42) =>
      setPreview({ state, progress, running: false });
    return () => {
      delete window.noAgentScreenPreview;
    };
  }, []);

  const { running, state } = preview;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- runs the fake download on a timer
  useEffect(() => {
    if (!running || state !== "installing") return;
    const timer = window.setInterval(
      () =>
        setPreview((current) =>
          current.progress >= 1
            ? { ...current, state: "closed", running: false }
            : { ...current, progress: Math.min(1, current.progress + 0.04) },
        ),
      200,
    );
    return () => window.clearInterval(timer);
  }, [running, state]);

  if (state === "closed") return children;

  const view: NoAgentScreenView =
    state === "installing"
      ? { kind: "installing", progress: preview.progress, slow: false }
      : state === "starting"
        ? { kind: "installing", progress: null, slow: false }
        : state === "slow"
          ? { kind: "installing", progress: null, slow: true }
          : state === "failed" || state === "retrying"
            ? { kind: "failed", message: FAILED_MESSAGE }
            : { kind: "offer" };
  const install = () => setPreview({ state: "installing", progress: 0, running: true });
  return (
    <NoAgentScreen
      view={view}
      retrying={state === "retrying"}
      {...(state === "copied" ? { copied: true } : {})}
      onInstall={install}
      onRetry={install}
      onSetUpMyself={() => {
        setPreview((current) => ({ ...current, state: "closed", running: false }));
        void navigate({ to: "/welcome" });
      }}
    />
  );
}
