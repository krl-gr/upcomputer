// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  auth: null as Record<string, unknown> | null,
  rejectCallback: null as ((error: Error) => void) | null,
}));

vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (atom: string | null) => ({
    data:
      atom === "auth"
        ? state.auth
        : atom === "install"
          ? { phase: "idle", installedVersion: "1.0.0", version: "1.0.0", source: "managed" }
          : null,
    error: null,
  }),
}));
vi.mock("../../state/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../state/server")>()),
  serverEnvironment: {
    providerAuthState: () => "auth",
    providerInstallState: () => "install",
    chatGptHandoffState: () => "handoff",
  },
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: () => vi.fn(async () => ({ _tag: "Success", value: {} })),
}));
vi.mock("../../state/environments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../state/environments")>()),
  useEnvironmentHttpBaseUrl: () => "http://127.0.0.1:3773",
  usePrimaryEnvironmentId: () => null,
  useEnvironment: () => null,
}));
vi.mock("../../state/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../state/session")>()),
  useEnvironmentScope: () => true,
}));
vi.mock("../../localApi", () => ({
  ensureLocalApi: () => ({ shell: { openExternal: vi.fn() } }),
}));

import { CodexSetupSection } from "./CodexSetupSection";

let root: Root;
let container: HTMLDivElement;

const provider: ServerProvider = {
  instanceId: ProviderInstanceId.make("codex"),
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "error",
  auth: { status: "unauthenticated" },
  checkedAt: "2026-10-17T00:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
  setup: { canAuthenticate: true, canInstall: true },
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.auth = {
    phase: "waiting",
    flowId: "flow-1",
    authorizationUrl: "https://auth.openai.com/authorize",
  };
  Object.assign(window, {
    desktopBridge: {
      receiveProviderAuthCallback: () =>
        new Promise<string>((_, reject) => {
          state.rejectCallback = reject;
        }),
      cancelProviderAuthCallback: vi.fn(async () => undefined),
    },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  Reflect.deleteProperty(window, "desktopBridge");
});

function render() {
  act(() => {
    root.render(
      <CodexSetupSection
        presentation="onboarding"
        environmentId={EnvironmentId.make("env")}
        instanceId={ProviderInstanceId.make("codex")}
        provider={provider}
        mode="managed"
        enabled
        onModeChange={() => undefined}
      />,
    );
  });
}

async function openSignInPage() {
  const open = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Open sign-in page",
  );
  await act(async () => open?.click());
}

it("treats a cancelled sign-in as cancelled, not as a failure", async () => {
  render();
  await openSignInPage();
  state.auth = { phase: "cancelled", flowId: "flow-1", message: "Sign-in cancelled." };
  render();
  await act(async () => state.rejectCallback?.(new Error("cancelled")));
  expect(container.textContent).toContain("Sign-in cancelled.");
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("shows the redirect URL field along with a real sign-in failure", async () => {
  render();
  await openSignInPage();
  await act(async () => state.rejectCallback?.(new Error("callback server failed")));
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "Could not finish sign-in on this computer. Try again.",
  );
  expect(container.querySelector('[aria-label="ChatGPT sign-in redirect URL"]')).not.toBeNull();
});
