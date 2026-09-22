import type { DesktopBridge, PreviewAutomationSnapshot } from "@upcomputer/contracts";
import { it as effectIt } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { beforeAll, beforeEach, describe, expect, vi } from "vite-plus/test";

import * as IpcChannels from "./ipc/channels.ts";
import * as PreviewIpc from "./ipc/methods/preview.ts";
import * as PreviewManager from "./preview/Manager.ts";

const electron = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("@clerk/electron/preload", () => ({
  exposeClerkBridge: vi.fn(),
}));

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
  contextBridge: {
    exposeInMainWorld: electron.exposeInMainWorld,
  },
  ipcRenderer: {
    invoke: electron.invoke,
    on: vi.fn(),
    removeListener: vi.fn(),
    sendSync: vi.fn(),
  },
  session: {
    fromPartition: vi.fn(() => {
      throw new Error("Session can only be received when app is ready");
    }),
  },
  webContents: {
    fromId: vi.fn(() => null),
  },
}));

let previewBridge: NonNullable<DesktopBridge["preview"]>;

const encodeClickInMainProcess = (
  click: PreviewManager.PreviewManager["Service"]["automationClick"],
) =>
  PreviewIpc.automationClick.handler({ tabId: "tab-1", input: { selector: "[broken" } }).pipe(
    Effect.provideService(PreviewManager.PreviewManager, {
      automationClick: click,
    } as PreviewManager.PreviewManager["Service"]),
  );

const encodeSnapshotInMainProcess = (
  snapshot: PreviewManager.PreviewManager["Service"]["automationSnapshot"],
) =>
  PreviewIpc.automationSnapshot.handler({ tabId: "tab-1" }).pipe(
    Effect.provideService(PreviewManager.PreviewManager, {
      automationSnapshot: snapshot,
    } as PreviewManager.PreviewManager["Service"]),
  );

const snapshot: PreviewAutomationSnapshot = {
  url: "https://example.com/",
  title: "Example Domain",
  loading: false,
  visibleText: "Example Domain",
  interactiveElements: [],
  accessibilityTree: { role: "RootWebArea" },
  consoleEntries: [],
  networkEntries: [],
  actionTimeline: [],
  screenshot: {
    mimeType: "image/png",
    data: "cG5n",
    width: 800,
    height: 600,
  },
};

describe("preview automation preload bridge", () => {
  beforeAll(async () => {
    await import("./preload.ts");
    const exposure = electron.exposeInMainWorld.mock.calls.find(([key]) => key === "desktopBridge");
    if (exposure === undefined) throw new Error("desktopBridge was not exposed");
    const exposedBridge = exposure[1] as DesktopBridge;
    if (exposedBridge.preview === undefined) throw new Error("preview bridge was not exposed");
    previewBridge = exposedBridge.preview;
  });

  beforeEach(() => {
    electron.invoke.mockReset();
  });

  effectIt.effect("returns successfully after the main process encodes a successful click", () =>
    Effect.gen(function* () {
      const encodedResult = yield* encodeClickInMainProcess(() => Effect.void);
      electron.invoke.mockResolvedValue(encodedResult);

      const result = yield* Effect.promise(() =>
        previewBridge.automation.click("tab-1", { selector: "#target" }),
      );
      expect(result).toBeUndefined();
      expect(electron.invoke).toHaveBeenCalledWith(IpcChannels.PREVIEW_AUTOMATION_CLICK_CHANNEL, {
        tabId: "tab-1",
        input: { selector: "#target" },
      });
    }),
  );

  effectIt.effect("returns a snapshot after the main process encodes it", () =>
    Effect.gen(function* () {
      const encodedResult = yield* encodeSnapshotInMainProcess(() => Effect.succeed(snapshot));
      electron.invoke.mockResolvedValue(encodedResult);

      const result = yield* Effect.promise(() => previewBridge.automation.snapshot("tab-1"));
      expect(result).toEqual(snapshot);
      expect(electron.invoke).toHaveBeenCalledWith(
        IpcChannels.PREVIEW_AUTOMATION_SNAPSHOT_CHANNEL,
        {
          tabId: "tab-1",
        },
      );
    }),
  );

  effectIt.effect("preserves an unavailable tab when it closes before snapshot IPC runs", () =>
    Effect.gen(function* () {
      const encodedResult = yield* encodeSnapshotInMainProcess(() =>
        Effect.fail(
          new PreviewManager.PreviewWebContentsNotFoundError({
            tabId: "tab-1",
            webContentsId: 42,
          }),
        ),
      );
      electron.invoke.mockResolvedValue(encodedResult);

      const result = yield* Effect.promise(() =>
        previewBridge.automation.snapshot("tab-1").then(
          () => ({ ok: true as const }),
          (error: unknown) => ({ ok: false as const, error }),
        ),
      );
      expect(result).toEqual({
        ok: false,
        error: {
          desktopPreviewAutomationError: true,
          error: {
            _tag: "PreviewAutomationTabNotFoundError",
            message: "The preview tab is closed or unavailable.",
          },
        },
      });
    }),
  );

  effectIt.effect("sanitizes unexpected snapshot failures before crossing IPC", () =>
    Effect.gen(function* () {
      const encodedResult = yield* encodeSnapshotInMainProcess(() =>
        Effect.fail(
          new PreviewManager.PreviewOperationError({
            operation: "automationSnapshot.captureScreenshot",
            tabId: "tab-1",
            cause: new Error("private snapshot detail"),
          }),
        ),
      );
      electron.invoke.mockResolvedValue(encodedResult);

      const result = yield* Effect.promise(() =>
        previewBridge.automation.snapshot("tab-1").then(
          () => ({ ok: true as const }),
          (error: unknown) => ({ ok: false as const, error }),
        ),
      );
      expect(result).toEqual({
        ok: false,
        error: {
          desktopPreviewAutomationError: true,
          error: {
            _tag: "PreviewAutomationExecutionError",
            message: "The desktop could not complete the snapshot.",
          },
        },
      });
    }),
  );

  const failureCases = [
    {
      name: "invalid selector",
      failure: new PreviewManager.PreviewAutomationInvalidSelectorError({
        operation: "click",
        tabId: "tab-1",
        selectorKind: "selector",
        selectorLength: 10,
        reasonLength: 18,
        cause: new Error("private parser detail"),
      }),
      expected: {
        _tag: "PreviewAutomationInvalidSelectorError",
        message: "The click locator or selector is invalid.",
        detail: { selectorKind: "selector", selectorLength: 10 },
      },
    },
    {
      name: "missing target",
      failure: new PreviewManager.PreviewAutomationTargetNotFoundError({
        operation: "click",
        tabId: "tab-1",
        selectorKind: "selector",
        selectorLength: 10,
      }),
      expected: {
        _tag: "PreviewAutomationTargetNotFoundError",
        message: "The click target was not found or was not actionable.",
        detail: { selectorKind: "selector", selectorLength: 10 },
      },
    },
    {
      name: "unavailable tab",
      failure: new PreviewManager.PreviewTabNotFoundError({ tabId: "tab-1" }),
      expected: {
        _tag: "PreviewAutomationTabNotFoundError",
        message: "The preview tab is closed or unavailable.",
      },
    },
  ] as const;

  for (const { name, failure, expected } of failureCases) {
    effectIt.effect(`preserves a bounded ${name} error across main-process IPC`, () =>
      Effect.gen(function* () {
        const encodedResult = yield* encodeClickInMainProcess(() => Effect.fail(failure));
        electron.invoke.mockResolvedValue(encodedResult);

        const result = yield* Effect.promise(() =>
          previewBridge.automation.click("tab-1", { selector: "[broken" }).then(
            () => ({ ok: true as const }),
            (error: unknown) => ({ ok: false as const, error }),
          ),
        );
        expect(result).toEqual({
          ok: false,
          error: {
            desktopPreviewAutomationError: true,
            error: expected,
          },
        });
      }),
    );
  }
});
