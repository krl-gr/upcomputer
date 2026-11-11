import type { EnvironmentId } from "@t3tools/contracts";

export const BOTS_ORDER_STORAGE_KEY = "upcomputer:bots-order";

type OrderedBot = { readonly agent: { readonly id: string } };

/** A bot's place in the sidebar order: bots are per computer, so the key names both. */
export const botOrderKey = (environmentId: EnvironmentId, bot: OrderedBot) =>
  `${environmentId}:${bot.agent.id}`;

interface PlacedBot {
  readonly environmentId: EnvironmentId;
  readonly bot: OrderedBot;
}

/** The bots in the saved order; bots it does not name yet, such as new ones, follow in list order. */
export function orderBots<T extends PlacedBot>(
  bots: ReadonlyArray<T>,
  order: ReadonlyArray<string>,
): ReadonlyArray<T> {
  const ranks = new Map(order.map((key, index) => [key, index]));
  const rank = (item: T) =>
    ranks.get(botOrderKey(item.environmentId, item.bot)) ?? Number.POSITIVE_INFINITY;
  return bots
    .map((item, index) => ({ item, index, rank: rank(item) }))
    .toSorted((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ item }) => item);
}

/**
 * The saved order after dropping `activeKey` on `overKey`'s place. It holds every bot of the
 * loaded lists and forgets their deleted ones; keys of computers not loaded now (offline or
 * filtered out) keep their places for when they show again.
 */
export function moveBotInOrder(input: {
  readonly order: ReadonlyArray<string>;
  readonly lists: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly bots: ReadonlyArray<OrderedBot>;
  }>;
  readonly activeKey: string;
  readonly overKey: string;
}): ReadonlyArray<string> {
  const { order, lists, activeKey, overKey } = input;
  const known = new Set(
    lists.flatMap(({ environmentId, bots }) => bots.map((bot) => botOrderKey(environmentId, bot))),
  );
  const keys = order.filter(
    (key) =>
      known.has(key) || !lists.some(({ environmentId }) => key.startsWith(`${environmentId}:`)),
  );
  const kept = new Set(keys);
  for (const key of known) if (!kept.has(key)) keys.push(key);
  const from = keys.indexOf(activeKey);
  const to = keys.indexOf(overKey);
  if (from < 0 || to < 0 || from === to) return order;
  keys.splice(from, 1);
  keys.splice(to, 0, activeKey);
  return keys;
}
