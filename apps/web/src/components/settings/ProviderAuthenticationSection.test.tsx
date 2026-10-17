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
  openExternal: vi.fn(async (_url: string) => undefined),
}));

vi.mock("../../state/query", () => ({
  useEnvironmentQuery: () => ({ data: state.auth, error: null }),
}));
vi.mock("../../state/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../state/server")>()),
  serverEnvironment: {
    providerAuthState: () => "auth",
    startProviderAuth: "start",
    respondProviderAuth: "respond",
    completeProviderAuth: "complete",
    cancelProviderAuth: "cancel",
    logoutProviderAuth: "logout",
  },
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: () => async () => ({ _tag: "Success", value: {} }),
}));
vi.mock("../../localApi", () => ({
  ensureLocalApi: () => ({ shell: { openExternal: state.openExternal } }),
}));

import { ProviderAuthenticationSection } from "./ProviderAuthenticationSection";

let root: Root;
let container: HTMLDivElement;

const provider: ServerProvider = {
  instanceId: ProviderInstanceId.make("cursor"),
  driver: ProviderDriverKind.make("cursor"),
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "error",
  auth: { status: "unauthenticated" },
  checkedAt: "2026-10-17T00:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
  setup: { canAuthenticate: true, canInstall: false },
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.auth = { phase: "idle" };
  state.openExternal.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(openBrowserOnStart: boolean) {
  act(() => {
    root.render(
      <ProviderAuthenticationSection
        environmentId={EnvironmentId.make("env")}
        environmentLabel="This computer"
        instanceId={ProviderInstanceId.make("cursor")}
        provider={provider}
        readOnly={false}
        openBrowserOnStart={openBrowserOnStart}
      />,
    );
  });
}

async function signIn(openBrowserOnStart: boolean) {
  render(openBrowserOnStart);
  const button = [...container.querySelectorAll("button")].find(
    (element) => element.textContent === "Sign in",
  );
  await act(async () => button?.click());
  state.auth = {
    phase: "waiting",
    flowId: "flow-1",
    interaction: {
      id: "browser-1",
      type: "browser",
      url: "https://cursor.com/loginDeepControl",
      requiresConsent: false,
      acceptsCallback: false,
    },
  };
  await act(async () => render(openBrowserOnStart));
}

it("opens the sign-in page by itself when asked to", async () => {
  await signIn(true);
  expect(state.openExternal).toHaveBeenCalledExactlyOnceWith("https://cursor.com/loginDeepControl");

  await act(async () => render(true));
  expect(state.openExternal).toHaveBeenCalledOnce();
});

it("leaves opening the sign-in page to the user otherwise", async () => {
  await signIn(false);
  expect(state.openExternal).not.toHaveBeenCalled();
});
