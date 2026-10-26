import { useEffect } from "react";
import { act, render } from "../../../test/render";
import { DEFAULT_UNIFIED_SETTINGS, type UnifiedSettings } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  settings: null as UnifiedSettings | null,
  update: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock(import("../../hooks/useTheme"), async (original) => ({
  ...(await original()),
  useTheme: () =>
    ({
      theme: "system",
      followSystem: true,
      themeHalves: null,
      setTheme: vi.fn(),
      setFollowSystem: vi.fn(),
      setThemeHalf: vi.fn(),
      clearThemeHalves: vi.fn(),
    }) as never,
  readThemePreference: () => "system",
  readThemeHalves: () => null,
  readAppearanceModePreference: () => "system",
}));
vi.mock(import("./useScopedSettings"), async (original) => ({
  ...(await original()),
  useScopedSettings: (() => state.settings!) as never,
  useUpdateScopedSettings: () => state.update,
}));
vi.mock(import("../../localApi"), async (original) => ({
  ...(await original()),
  readLocalApi: () => ({ dialogs: { confirm: state.confirm } }) as never,
}));

import { useSettingsRestore } from "./SettingsPanels";

async function renderRestore() {
  let restore!: ReturnType<typeof useSettingsRestore>;
  function Probe() {
    const result = useSettingsRestore();
    useEffect(() => {
      restore = result;
    });
    return null;
  }
  const screen = await render(<Probe />);
  return {
    ...screen,
    get restore() {
      return restore;
    },
  };
}
function setup() {
  vi.clearAllMocks();
  state.settings = { ...DEFAULT_UNIFIED_SETTINGS };
  state.confirm.mockResolvedValue(true);
}

describe("restoring V2 settings", () => {
  it("restores waking a chat when tasks complete after it was turned off", async () => {
    setup();
    state.settings = { ...DEFAULT_UNIFIED_SETTINGS, wakeChatOnTaskCompletion: false };
    await using screen = await renderRestore();
    const { restore } = screen;

    expect(restore.changedSettingLabels).toEqual(["Wake chat when tasks complete"]);
    await act(() => restore.restoreDefaults());

    expect(state.update.mock.calls[0]?.[0].wakeChatOnTaskCompletion).toBe(true);
  });

  it("restores the thread details card after it was turned off", async () => {
    setup();
    state.settings = { ...DEFAULT_UNIFIED_SETTINGS, threadDetailsEnabled: false };
    await using screen = await renderRestore();
    const { restore } = screen;

    expect(restore.changedSettingLabels).toEqual(["Thread details"]);
    await act(() => restore.restoreDefaults());

    expect(state.update.mock.calls[0]?.[0].threadDetailsEnabled).toBe(true);
  });
});
