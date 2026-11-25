import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { act, createElement } from "react";
import { create } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";

/** The Bots section's code, which the sidebar loads on first render. */
const chunk = vi.hoisted(() => {
  let load: (module: unknown) => void = () => {};
  const loaded = new Promise((resolve) => (load = resolve));
  return { loaded, load };
});

vi.mock("./bots/Bots.tsx", () => chunk.loaded);
vi.mock("./bots/botMenu.ts", () => chunk.loaded);

import { claimedSidebarThreadKeys } from "../../../apps/web/src/product/sidebarThreadClaims.ts";
import {
  removeLocalStorageItem,
  writeLocalStorageValue,
} from "../../../apps/web/src/hooks/useLocalStorage.ts";
import { BOT_CHATS_STORAGE_KEY, BotChats } from "./bots/rememberedBotChats.ts";
import { TASKS_WEB_FEATURE } from "./feature.tsx";

describe("the sidebar's Bots section", () => {
  it("keeps the remembered bot chats out of Threads while its code loads", async () => {
    // The first start after updating from 0.0.40 loads this code from a cold cache, and the
    // remembered Chef and Builder chats showed under Threads until it arrived.
    const here = EnvironmentId.make("feature-remembered");
    const chat = scopedThreadKey(scopeThreadRef(here, ThreadId.make("chef-chat")));
    writeLocalStorageValue(BOT_CHATS_STORAGE_KEY, { [here]: ["chef-chat"] }, {}, BotChats);
    const Section = TASKS_WEB_FEATURE.sidebarSection!;
    const view = await act(async () => create(createElement(Section)));
    expect([...claimedSidebarThreadKeys()]).toEqual([chat]);

    // Loaded: the section itself claims what its lists say from here on.
    await act(async () => chunk.load({ SidebarBots: () => null }));
    expect([...claimedSidebarThreadKeys()]).toEqual([]);
    view.unmount();
    removeLocalStorageItem(BOT_CHATS_STORAGE_KEY);
  });
});
