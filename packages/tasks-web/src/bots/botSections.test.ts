import { EnvironmentId } from "@t3tools/contracts";
import { act, createElement } from "react";
import { create } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

/** Each environment's answer to the bots list. */
const servers = vi.hoisted(() => ({ lists: new Map<string, () => Promise<unknown>>() }));

vi.mock("../environmentApi.ts", () => {
  const access = { availability: "enabled", canReadAgents: true };
  return {
    readTasksWebAccess: () => access,
    useTasksWebAccess: () => access,
    subscribeTasksWebAccess: () => () => {},
    readTasksWebClient: (environmentId: string) => ({
      bots: {
        list: () => servers.lists.get(environmentId)!(),
      },
      // Like the real stream, a subscription starts with a sync, which loads the list.
      tasks: {
        subscribe: (listener: (change: { kind: "sync" }) => void) => {
          listener({ kind: "sync" });
          return () => {};
        },
      },
    }),
  };
});

import { botSectionTitle, useBotSectionEnvironmentIds, useBots } from "./botData.tsx";

// An older server's RPC layer dies on a method it does not know; the defect reaches the
// client as this string.
const unknownMethod = () => Promise.reject("Unknown request tag: upcomputer.bots.v1.list");

async function render(environmentIds: ReadonlyArray<EnvironmentId>) {
  const seen = {
    shown: [] as Array<ReadonlyArray<EnvironmentId>>,
    lists: [] as Array<ReturnType<typeof useBots>>,
  };
  function Sections() {
    const shown = useBotSectionEnvironmentIds(environmentIds);
    seen.shown.push(shown);
    return shown.map((environmentId) =>
      createElement(Section, { key: environmentId, environmentId }),
    );
  }
  function Section({ environmentId }: { readonly environmentId: EnvironmentId }) {
    seen.lists.push(useBots(environmentId));
    return null;
  }
  const view = await act(async () => create(createElement(Sections)));
  await act(async () => {});
  return { seen, view };
}

afterEach(() => {
  servers.lists.clear();
});

describe("Bots sections per computer", () => {
  it("leaves out a computer whose server predates bots, without an error", async () => {
    const here = EnvironmentId.make("sections-here");
    const older = EnvironmentId.make("sections-older-mac");
    servers.lists.set(here, () => Promise.resolve([]));
    servers.lists.set(older, unknownMethod);
    const { seen, view } = await render([here, older]);
    expect(seen.shown.at(-1)).toEqual([here]);
    expect(seen.lists.at(-1)).toMatchObject({ enabled: true, loaded: true, error: "" });
    view.unmount();
  });

  it("keeps a section with its error when a server with bots fails", async () => {
    const failing = EnvironmentId.make("sections-failing");
    servers.lists.set(failing, () => Promise.reject(new Error("The database is locked")));
    const { seen, view } = await render([failing]);
    expect(seen.shown.at(-1)).toEqual([failing]);
    expect(seen.lists.at(-1)).toMatchObject({
      enabled: true,
      error: "The database is locked.",
    });
    view.unmount();
  });

  it("shows no section while a computer's list is still loading", async () => {
    const slow = EnvironmentId.make("sections-slow");
    servers.lists.set(slow, () => new Promise(() => {}));
    const { seen, view } = await render([slow]);
    expect(seen.shown.at(-1)).toEqual([]);
    view.unmount();
  });

  it("lists every computer that has bots, in order", async () => {
    const here = EnvironmentId.make("sections-two-here");
    const other = EnvironmentId.make("sections-two-other");
    servers.lists.set(here, () => Promise.resolve([]));
    servers.lists.set(other, () => Promise.resolve([]));
    const { seen, view } = await render([here, other]);
    expect(seen.shown.at(-1)).toEqual([here, other]);
    view.unmount();
  });
});

describe("botSectionTitle", () => {
  it("names the computer only when several computers show bots", () => {
    expect(botSectionTitle("MacBook Pro", true)).toBe("Bots · MacBook Pro");
    expect(botSectionTitle("MacBook Pro", false)).toBe("Bots");
    expect(botSectionTitle(undefined, true)).toBe("Bots");
  });
});
