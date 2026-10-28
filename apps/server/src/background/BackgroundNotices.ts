import type { BackgroundNotice } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

const MAX_NOTICES = 50;

/**
 * Background work with no thread to report into: reminders, automations,
 * scheduled runs, worktree cleanup, remote access. Clients show these in one
 * notifications place. Kept in memory: they describe this server's run.
 */
export class BackgroundNotices extends Context.Service<
  BackgroundNotices,
  {
    /** Adds the notice, or refreshes the one with the same id. */
    readonly report: (notice: Omit<BackgroundNotice, "occurredAt">) => Effect.Effect<void>;
    /** Removes the notice once its problem is gone. */
    readonly resolve: (id: string) => Effect.Effect<void>;
    readonly list: Effect.Effect<ReadonlyArray<BackgroundNotice>>;
    readonly changes: Stream.Stream<ReadonlyArray<BackgroundNotice>>;
  }
>()("t3/background/BackgroundNotices") {}

const make = Effect.gen(function* () {
  const notices = yield* SubscriptionRef.make<ReadonlyArray<BackgroundNotice>>([]);
  const report: BackgroundNotices["Service"]["report"] = (notice) =>
    Effect.gen(function* () {
      const occurredAt = DateTime.formatIso(yield* DateTime.now);
      yield* SubscriptionRef.update(notices, (current) =>
        [{ ...notice, occurredAt }, ...current.filter((entry) => entry.id !== notice.id)].slice(
          0,
          MAX_NOTICES,
        ),
      );
    });
  const resolve: BackgroundNotices["Service"]["resolve"] = (id) =>
    SubscriptionRef.update(notices, (current) =>
      current.some((entry) => entry.id === id)
        ? current.filter((entry) => entry.id !== id)
        : current,
    );
  return BackgroundNotices.of({
    report,
    resolve,
    list: SubscriptionRef.get(notices),
    changes: SubscriptionRef.changes(notices),
  });
});

export const layer = Layer.effect(BackgroundNotices, make);
