import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { botOrderKey, moveBotInOrder, orderBots } from "./botOrder.ts";

const here = EnvironmentId.make("env-here");
const there = EnvironmentId.make("env-there");
const placed = (environmentId: EnvironmentId, id: string) => ({
  environmentId,
  bot: { agent: { id } },
});
const key = (environmentId: EnvironmentId, id: string) =>
  botOrderKey(environmentId, { agent: { id } });
const ids = (bots: ReadonlyArray<ReturnType<typeof placed>>) =>
  bots.map(({ environmentId, bot }) => `${environmentId === here ? "" : "there:"}${bot.agent.id}`);
const lists = (hereIds: ReadonlyArray<string>, thereIds: ReadonlyArray<string> | null = null) => [
  { environmentId: here, bots: hereIds.map((id) => ({ agent: { id } })) },
  ...(thereIds ? [{ environmentId: there, bots: thereIds.map((id) => ({ agent: { id } })) }] : []),
];

describe("orderBots", () => {
  const shown = [placed(here, "a"), placed(here, "b"), placed(there, "c"), placed(here, "d")];

  it("keeps the list order while nothing was moved", () => {
    expect(ids(orderBots(shown, []))).toEqual(["a", "b", "there:c", "d"]);
  });

  it("follows the saved order across computers and puts new bots at the end", () => {
    const order = [key(there, "c"), key(here, "a"), key(here, "gone")];
    expect(ids(orderBots(shown, order))).toEqual(["there:c", "a", "b", "d"]);
  });
});

describe("moveBotInOrder", () => {
  const move = (
    order: ReadonlyArray<string>,
    current: ReturnType<typeof lists>,
    activeKey: string,
    overKey: string,
  ) => moveBotInOrder({ order, lists: current, activeKey, overKey });

  it("moves a bot down onto another's place, and up again", () => {
    const down = move([], lists(["a", "b", "c"]), key(here, "a"), key(here, "c"));
    expect(down).toEqual([key(here, "b"), key(here, "c"), key(here, "a")]);
    const up = move(down, lists(["a", "b", "c"]), key(here, "a"), key(here, "b"));
    expect(up).toEqual([key(here, "a"), key(here, "b"), key(here, "c")]);
  });

  it("adds bots created since the last move at the end before moving", () => {
    const order = [key(here, "b"), key(here, "a")];
    expect(move(order, lists(["a", "b", "new"]), key(here, "new"), key(here, "b"))).toEqual([
      key(here, "new"),
      key(here, "b"),
      key(here, "a"),
    ]);
  });

  it("forgets deleted bots of loaded computers and keeps other computers' places", () => {
    const order = [key(there, "x"), key(here, "deleted"), key(here, "a"), key(here, "b")];
    expect(move(order, lists(["a", "b"]), key(here, "b"), key(here, "a"))).toEqual([
      key(there, "x"),
      key(here, "b"),
      key(here, "a"),
    ]);
  });

  it("moves a bot between computers' bots", () => {
    const order = move([], lists(["a"], ["x", "y"]), key(here, "a"), key(there, "y"));
    expect(order).toEqual([key(there, "x"), key(there, "y"), key(here, "a")]);
    expect(
      ids(orderBots([placed(here, "a"), placed(there, "x"), placed(there, "y")], order)),
    ).toEqual(["there:x", "there:y", "a"]);
  });

  it("leaves the order as it was for a drop on itself or on a bot no longer listed", () => {
    const order = [key(here, "a"), key(here, "b")];
    expect(move(order, lists(["a", "b"]), key(here, "a"), key(here, "a"))).toBe(order);
    expect(move(order, lists(["a"]), key(here, "a"), key(here, "b"))).toBe(order);
  });
});
