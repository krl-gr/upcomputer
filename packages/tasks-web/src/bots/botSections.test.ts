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

import { useBotSectionLists } from "./botData.tsx";

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

afterEach(() => {
  servers.lists.clear();
});

describe("Bots section lists", () => {
  it("leaves out a computer whose server predates bots, without an error", async () => {
    const here = EnvironmentId.make("sections-here");
    const older = EnvironmentId.make("sections-older-mac");
    servers.lists.set(here, () => Promise.resolve([]));
    servers.lists.set(older, unknownMethod);
    const { seen, view } = await render([here, older]);
    expect(seen.at(-1)).toEqual([{ environmentId: here, bots: [], error: "" }]);
    view.unmount();
  });

  it("keeps a computer with its error when a server with bots fails", async () => {
    const failing = EnvironmentId.make("sections-failing");
    servers.lists.set(failing, () => Promise.reject(new Error("The database is locked")));
    const { seen, view } = await render([failing]);
    expect(seen.at(-1)).toEqual([
      { environmentId: failing, bots: [], error: "The database is locked." },
    ]);
    view.unmount();
  });

  it("adds nothing while a computer's list is still loading", async () => {
    const slow = EnvironmentId.make("sections-slow");
    servers.lists.set(slow, () => new Promise(() => {}));
    const { seen, view } = await render([slow]);
    expect(seen.at(-1)).toEqual([]);
    view.unmount();
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
      { environmentId: here, bots: [nova], error: "" },
      { environmentId: other, bots: [atlas], error: "" },
    ]);
    view.unmount();
  });
});
