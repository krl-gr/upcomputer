import { useEffect } from "react";
import { act, render } from "../../../test/render";
import { DEFAULT_UNIFIED_SETTINGS, type UnifiedSettings } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  settings: null as UnifiedSettings | null,
  update: vi.fn(),
  confirm: vi.fn(),
  theme: "",
  setTheme: vi.fn(() => true),
}));

vi.mock(import("../../hooks/useTheme"), async (original) => ({
  ...(await original()),
  useTheme: () =>
    ({
      theme: state.theme,
      followSystem: true,
      themeHalves: null,
      setTheme: state.setTheme,
      setFollowSystem: vi.fn(),
      setThemeHalf: vi.fn(),
      clearThemeHalves: vi.fn(),
    }) as never,
  readThemePreference: () => state.theme,
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

import { DEFAULT_THEME_PREFERENCE } from "../../themePalette";
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
  state.theme = DEFAULT_THEME_PREFERENCE;
  state.confirm.mockResolvedValue(true);
}

describe("restoring V2 settings", () => {
  it("lists nothing on a fresh install, which wears the default theme", async () => {
    setup();
    await using screen = await renderRestore();

    expect(screen.restore.changedSettingLabels).toEqual([]);
  });

  it("restores the default theme, not the stock system theme", async () => {
    setup();
    state.theme = "system";
    await using screen = await renderRestore();
    const { restore } = screen;

    expect(restore.changedSettingLabels).toEqual(["Theme"]);
    await act(() => restore.restoreDefaults());

    expect(state.setTheme).toHaveBeenCalledWith(DEFAULT_THEME_PREFERENCE);
  });

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
