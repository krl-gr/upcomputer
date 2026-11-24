import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { act, createElement } from "react";
import { create } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

/** Each environment's answer to the bots list. */
const servers = vi.hoisted(() => ({
  lists: new Map<string, () => Promise<unknown>>(),
  /** Reports a stream failure, as the real one does to a listener that has had no event yet. */
  dropStream: undefined as (() => void) | undefined,
  /** Every computer's Tasks access; at a real start it is "loading" until the server answers. */
  access: { availability: "enabled", canReadAgents: true },
  accessListeners: new Set<() => void>(),
}));

vi.mock("../environmentApi.ts", () => {
  return {
    readTasksWebAccess: () => servers.access,
    useTasksWebAccess: () => servers.access,
    subscribeTasksWebAccess: (listener: () => void) => {
      servers.accessListeners.add(listener);
      return () => servers.accessListeners.delete(listener);
    },
    readTasksWebClient: (environmentId: string) => ({
      bots: {
        list: () => servers.lists.get(environmentId)!(),
      },
      // Like the real stream, a subscription starts with a sync, which loads the list.
      tasks: {
        subscribe: (
          listener: (change: { kind: "sync" }) => void,
          onError?: (error: unknown) => void,
        ) => {
          servers.dropStream = () => onError?.(new Error("Task change stream disconnected."));
          listener({ kind: "sync" });
          return () => {};
        },
      },
    }),
  };
});

import { readClientNotices } from "../../../../apps/web/src/sidebarNotifications/clientNotices.ts";
import { allSidebarThreadsClaimKey } from "../../../../apps/web/src/product/sidebarThreadClaims.ts";
import { TaskChangeStreamEnded } from "../rpc/taskChanges.ts";
import {
  readLocalStorageValue,
  removeLocalStorageItem,
  writeLocalStorageValue,
} from "../../../../apps/web/src/hooks/useLocalStorage.ts";
import {
  BOT_CHATS_STORAGE_KEY,
  BotChats,
  botsChanged,
  rememberedBotChatKeys,
  useBotSectionLists,
  useRememberedBotChatKeys,
} from "./botData.tsx";

const botNotices = (environmentId: EnvironmentId) =>
  readClientNotices().filter((notice) => notice.environmentId === environmentId);

// An older server's RPC layer dies on a method it does not know; the defect reaches the
// client as this string.
const unknownMethod = () => Promise.reject("Unknown request tag: upcomputer.bots.v1.list");

async function render(environmentIds: ReadonlyArray<EnvironmentId>) {
  const seen = [] as Array<ReturnType<typeof useBotSectionLists>>;
  function Section() {
    seen.push(useBotSectionLists(environmentIds));
    return null;
  }
  const view = await act(async () => create(createElement(Section)));
  await act(async () => {});
  return { seen, view };
}

function setAccess(availability: "loading" | "unavailable" | "enabled") {
  servers.access = { availability, canReadAgents: availability === "enabled" };
  for (const listener of servers.accessListeners) listener();
}

afterEach(() => {
  servers.lists.clear();
  servers.dropStream = undefined;
  servers.access = { availability: "enabled", canReadAgents: true };
  removeLocalStorageItem(BOT_CHATS_STORAGE_KEY);
});

describe("Bots section lists", () => {
  it("leaves out a computer whose server predates bots, with no notice", async () => {
    const here = EnvironmentId.make("sections-here");
    const older = EnvironmentId.make("sections-older-mac");
    servers.lists.set(here, () => Promise.resolve([]));
    servers.lists.set(older, unknownMethod);
    const { seen, view } = await render([here, older]);
    expect(seen.at(-1)).toEqual([{ environmentId: here, bots: [], loaded: true }]);
    expect(botNotices(older)).toEqual([]);
    view.unmount();
  });

  it("keeps a failing computer and says so in Notifications until a load works", async () => {
    const failing = EnvironmentId.make("sections-failing");
    servers.lists.set(failing, () => Promise.reject(new Error("The database is locked")));
    const { seen, view } = await render([failing]);
    expect(seen.at(-1)).toEqual([{ environmentId: failing, bots: [], loaded: false }]);
    const [notice] = botNotices(failing);
    expect(notice).toMatchObject({ id: "bots:list", detail: "The database is locked" });
    servers.lists.set(failing, () => Promise.resolve([]));
    await act(async () => notice?.retry?.());
    expect(seen.at(-1)).toEqual([{ environmentId: failing, bots: [], loaded: true }]);
    expect(botNotices(failing)).toEqual([]);
    view.unmount();
  });

  it("keeps the last list with no notice while the live-update stream reconnects", async () => {
    const here = EnvironmentId.make("sections-reconnecting");
    servers.lists.set(here, () => Promise.resolve([]));
    const { seen, view } = await render([here]);
    await act(async () => servers.dropStream?.());
    expect(seen.at(-1)).toEqual([{ environmentId: here, bots: [], loaded: true }]);
    expect(botNotices(here)).toEqual([]);
    // A load cut off by the drop is no failed list either.
    servers.lists.set(here, () => Promise.reject(new TaskChangeStreamEnded()));
    await act(async () => botsChanged());
    expect(botNotices(here)).toEqual([]);
    view.unmount();
  });

  it("adds nothing while a computer's list is still loading", async () => {
    const slow = EnvironmentId.make("sections-slow");
    servers.lists.set(slow, () => new Promise(() => {}));
    const { seen, view } = await render([slow]);
    expect(seen.at(-1)).toEqual([]);
    view.unmount();
  });

  it("keeps each computer's bot chats out of Threads from the last list until its list loads", async () => {
    const here = EnvironmentId.make("sections-remembered");
    const chat = scopedThreadKey(scopeThreadRef(here, ThreadId.make("nova-chat")));
    writeLocalStorageValue(BOT_CHATS_STORAGE_KEY, { [here]: ["nova-chat"] }, {}, BotChats);
    let answer: (bots: unknown) => void = () => {};
    servers.lists.set(here, () => new Promise((resolve) => (answer = resolve)));
    const { view } = await render([here]);
    expect(rememberedBotChatKeys([here])).toEqual([chat]);

    // Loaded: the Bots section claims its chats itself, and the next start remembers this list.
    await act(async () => answer([{ agent: { id: "atlas" }, threadId: "atlas-chat" }]));
    expect(rememberedBotChatKeys([here])).toEqual([]);
    expect(readLocalStorageValue(BOT_CHATS_STORAGE_KEY, {}, BotChats)).toEqual({
      [here]: ["atlas-chat"],
    });
    view.unmount();
  });

  it("keeps a computer's threads out of Threads until its first bot list loads", async () => {
    // The first start after updating from 0.0.39 remembers no list, and bot chats flashed
    // under Threads until the Bots section loaded.
    const here = EnvironmentId.make("sections-first-start");
    let answer: (bots: unknown) => void = () => {};
    servers.lists.set(here, () => new Promise((resolve) => (answer = resolve)));
    setAccess("loading");
    expect(rememberedBotChatKeys([here])).toEqual([allSidebarThreadsClaimKey(here)]);

    setAccess("enabled");
    const { view } = await render([here]);
    expect(rememberedBotChatKeys([here])).toEqual([allSidebarThreadsClaimKey(here)]);
    await act(async () => answer([]));
    expect(rememberedBotChatKeys([here])).toEqual([]);
    view.unmount();
  });

  it("keeps the remembered bot chats claimed while the computer's Tasks access is checked", async () => {
    const here = EnvironmentId.make("sections-remembered-at-start");
    const chat = scopedThreadKey(scopeThreadRef(here, ThreadId.make("nova-chat")));
    writeLocalStorageValue(BOT_CHATS_STORAGE_KEY, { [here]: ["nova-chat"] }, {}, BotChats);
    let answer: (bots: unknown) => void = () => {};
    servers.lists.set(here, () => new Promise((resolve) => (answer = resolve)));
    setAccess("loading");
    const claims = [] as string[];
    function Claims() {
      claims.push(useRememberedBotChatKeys([here]));
      return null;
    }
    const view = await act(async () => create(createElement(Claims)));
    expect(claims.at(-1)).toBe(chat);

    // Access decided: the list starts loading, and the chats stay claimed meanwhile.
    await act(async () => setAccess("enabled"));
    expect(claims.at(-1)).toBe(chat);

    // Loaded: the Bots section claims the chats it lists itself.
    await act(async () => answer([{ agent: { id: "nova" }, threadId: "nova-chat" }]));
    expect(claims.at(-1)).toBe("");
    view.unmount();
  });

  it("drops the remembered bot chats of a computer that turns out not to serve Tasks", async () => {
    const older = EnvironmentId.make("sections-remembered-no-tasks");
    writeLocalStorageValue(BOT_CHATS_STORAGE_KEY, { [older]: ["nova-chat"] }, {}, BotChats);
    setAccess("loading");
    expect(rememberedBotChatKeys([older])).toHaveLength(1);
    setAccess("unavailable");
    expect(rememberedBotChatKeys([older])).toEqual([]);
  });

  it("merges every computer's bots, in order", async () => {
    const here = EnvironmentId.make("sections-two-here");
    const other = EnvironmentId.make("sections-two-other");
    const nova = { agent: { id: "nova" } };
    const atlas = { agent: { id: "atlas" } };
    servers.lists.set(here, () => Promise.resolve([nova]));
    servers.lists.set(other, () => Promise.resolve([atlas]));
    const { seen, view } = await render([here, other]);
    expect(seen.at(-1)).toEqual([
      { environmentId: here, bots: [nova], loaded: true },
      { environmentId: other, bots: [atlas], loaded: true },
    ]);
    view.unmount();
  });
});
