import type { AnyRouter } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vite-plus/test";

import { installChatRouteCommands } from "../shortcuts/chatRouteCommands";

const spies = vi.hoisted(() => ({
  openCommandPalette: vi.fn(),
  startNewThreadFromContext: vi.fn(),
  startScratchThread: vi.fn(),
}));
const state = vi.hoisted(() => ({
  surface: "upcomputer" as "upstream" | "upcomputer",
  boringSidebar: false,
}));

vi.mock("../commandPaletteBus", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../commandPaletteBus")>()),
  isCommandPaletteOpen: () => false,
  openCommandPalette: spies.openCommandPalette,
}));
// The pressed key stands for the command its binding resolves to.
vi.mock("../keybindings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../keybindings")>()),
  resolveShortcutCommand: (event: KeyboardEvent) => event.key,
}));
vi.mock("../hooks/useSettings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../hooks/useSettings")>()),
  getClientSettings: () => ({
    boringSidebarEnabled: state.boringSidebar,
    legacySidebarEnabled: false,
  }),
}));
// Several projects, so upstream's chat.new opens the "New thread in..." picker.
vi.mock("../sidebarProjectGrouping", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../sidebarProjectGrouping")>()),
  buildSidebarProjectSnapshots: () => [{}, {}],
}));
vi.mock("../hooks/useScratchProject", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../hooks/useScratchProject")>()),
  createScratchProjectActions: () => ({
    scratchEnvironmentId: () => "env-local",
    startScratchThread: spies.startScratchThread,
  }),
}));
vi.mock("../lib/chatThreadActions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/chatThreadActions")>()),
  startNewThreadFromContext: spies.startNewThreadFromContext,
}));
vi.mock("../product/productFlags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../product/productFlags")>()),
  productSurface: () => state.surface,
}));

const chatRouter = {
  state: {
    matches: [
      { routeId: "__root__", pathname: "/", params: {} },
      { routeId: "/_chat", pathname: "/", params: {} },
    ],
  },
} as unknown as AnyRouter;

function press(command: string) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: command, cancelable: true }));
}

function setup(overrides: Partial<typeof state> = {}): Disposable {
  state.surface = overrides.surface ?? "upcomputer";
  state.boringSidebar = overrides.boringSidebar ?? false;
  for (const spy of Object.values(spies)) spy.mockClear();
  const uninstall = installChatRouteCommands(chatRouter);
  return { [Symbol.dispose]: uninstall };
}

describe("New thread shortcuts", () => {
  it("chat.new starts a thread without a project under the UpComputer surface", () => {
    using _commands = setup();
    press("chat.new");
    expect(spies.startScratchThread).toHaveBeenCalledExactlyOnceWith("env-local");
    expect(spies.openCommandPalette).not.toHaveBeenCalled();
  });

  it("chat.new opens upstream's picker under the upstream surface", () => {
    using _commands = setup({ surface: "upstream" });
    press("chat.new");
    expect(spies.openCommandPalette).toHaveBeenCalledExactlyOnceWith({ open: "new-thread-in" });
    expect(spies.startScratchThread).not.toHaveBeenCalled();
  });

  it("chat.new keeps upstream's behaviour in the boring sidebar", () => {
    using _commands = setup({ boringSidebar: true });
    press("chat.new");
    expect(spies.startNewThreadFromContext).toHaveBeenCalledOnce();
    expect(spies.startScratchThread).not.toHaveBeenCalled();
  });

  it("chat.newLocal still creates in the current project", () => {
    using _commands = setup();
    press("chat.newLocal");
    expect(spies.startNewThreadFromContext).toHaveBeenCalledOnce();
    expect(spies.startScratchThread).not.toHaveBeenCalled();
    expect(spies.openCommandPalette).not.toHaveBeenCalled();
  });
});
