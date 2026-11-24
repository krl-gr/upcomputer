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
  "copied",
  "downloading",
  "starting",
  "slow",
  "retrying",
  "failedInstall",
  "failedTimeout",
  "failedModels",
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

const FAILED_REASONS = {
  failedInstall: "install",
  failedTimeout: "timeout",
  failedModels: "models",
} as const;

export function NoAgentScreenPreview({ children }: { readonly children: ReactNode }) {
  const navigate = useNavigate();
  const [preview, setPreview] = useState<{
    readonly state: PreviewState;
    readonly progress: number;
    /** A click in the preview runs a short fake install; a console call holds still. */
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
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- runs the fake install on a timer
  useEffect(() => {
    if (!running) return;
    if (state === "retrying" || state === "starting") {
      const timer = window.setTimeout(
        () =>
          setPreview((current) =>
            current.state === "retrying"
              ? { ...current, state: "downloading", progress: 0 }
              : { ...current, state: "closed", running: false },
          ),
        1_500,
      );
      return () => window.clearTimeout(timer);
    }
    if (state !== "downloading") return;
    const timer = window.setInterval(
      () =>
        setPreview((current) =>
          current.progress >= 1
            ? { ...current, state: "starting" }
            : { ...current, progress: Math.min(1, current.progress + 0.04) },
        ),
      200,
    );
    return () => window.clearInterval(timer);
  }, [running, state]);

  if (state === "closed") return children;

  const view: NoAgentScreenView =
    state === "downloading" || state === "starting" || state === "slow" || state === "retrying"
      ? { kind: "installing", phase: state, progress: preview.progress }
      : state === "failedInstall" || state === "failedTimeout" || state === "failedModels"
        ? { kind: "failed", reason: FAILED_REASONS[state] }
        : { kind: "offer" };
  return (
    <NoAgentScreen
      view={view}
      {...(state === "copied" ? { copied: true } : {})}
      onInstall={() => setPreview({ state: "downloading", progress: 0, running: true })}
      onTryAgain={() => setPreview({ state: "retrying", progress: 0, running: true })}
      onSetUpAnotherWay={() => setPreview({ state: "offer", progress: 0, running: false })}
      onSetUpMyself={() => {
        setPreview((current) => ({ ...current, state: "closed", running: false }));
        void navigate({ to: "/welcome" });
      }}
    />
  );
}
