import type { BackgroundNotice } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

const MAX_NOTICES = 50;
// Bounds the info notices folded into one entry; only the count is shown.
const MAX_FOLDED = 200;
const SEVERITY_RANK: Record<BackgroundNotice["severity"], number> = {
  info: 0,
  warning: 1,
  error: 2,
};

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

const kindOf = (notice: BackgroundNotice) => `${notice.area}\u0000${notice.title}`;

interface Entry {
  /** Newest first; more than one only for folded info notices. */
  readonly members: ReadonlyArray<BackgroundNotice>;
}

/**
 * Info notices of one kind (a sleep's worth of missed reminders or skipped
 * runs) fold into one entry. Warnings and errors stay one per problem.
 */
function entriesOf(notices: ReadonlyArray<BackgroundNotice>): ReadonlyArray<Entry> {
  const entries: Array<{ members: Array<BackgroundNotice> }> = [];
  const folded = new Map<string, { members: Array<BackgroundNotice> }>();
  for (const notice of notices) {
    if (notice.severity !== "info") {
      entries.push({ members: [notice] });
      continue;
    }
    const existing = folded.get(kindOf(notice));
    if (existing !== undefined) {
      existing.members.push(notice);
      continue;
    }
    const entry = { members: [notice] };
    folded.set(kindOf(notice), entry);
    entries.push(entry);
  }
  return entries;
}

/** Over the limit, the oldest info goes first, then warnings, then errors. */
function prune(notices: ReadonlyArray<BackgroundNotice>): ReadonlyArray<BackgroundNotice> {
  const entries = entriesOf(notices).map((entry) => ({
    members: entry.members.slice(0, MAX_FOLDED),
  }));
  const kept = [...entries];
  while (kept.length > MAX_NOTICES) {
    let evict = kept.length - 1;
    for (let index = kept.length - 1; index >= 0; index--) {
      if (
        SEVERITY_RANK[kept[index]!.members[0]!.severity] <
        SEVERITY_RANK[kept[evict]!.members[0]!.severity]
      ) {
        evict = index;
      }
    }
    kept.splice(evict, 1);
  }
  const keptIds = new Set(kept.flatMap((entry) => entry.members.map((notice) => notice.id)));
  return notices.filter((notice) => keptIds.has(notice.id));
}

function visible(notices: ReadonlyArray<BackgroundNotice>): ReadonlyArray<BackgroundNotice> {
  return entriesOf(notices).map(({ members }) => {
    const [newest] = members;
    return members.length === 1
      ? newest!
      : { ...newest!, message: `${newest!.message} ${members.length - 1} more like this.` };
  });
}

const make = Effect.gen(function* () {
  const notices = yield* SubscriptionRef.make<ReadonlyArray<BackgroundNotice>>([]);
  const report: BackgroundNotices["Service"]["report"] = Effect.fn("BackgroundNotices.report")(
    function* (notice) {
      const occurredAt = DateTime.formatIso(yield* DateTime.now);
      yield* SubscriptionRef.update(notices, (current) =>
        prune([{ ...notice, occurredAt }, ...current.filter((entry) => entry.id !== notice.id)]),
      );
    },
  );
  const resolve: BackgroundNotices["Service"]["resolve"] = (id) =>
    SubscriptionRef.get(notices).pipe(
      Effect.flatMap((current) =>
        current.some((entry) => entry.id === id)
          ? SubscriptionRef.update(notices, (latest) => latest.filter((entry) => entry.id !== id))
          : Effect.void,
      ),
    );
  return BackgroundNotices.of({
    report,
    resolve,
    list: SubscriptionRef.get(notices).pipe(Effect.map(visible)),
    changes: SubscriptionRef.changes(notices).pipe(Stream.map(visible)),
  });
});

export const layer = Layer.effect(BackgroundNotices, make);
