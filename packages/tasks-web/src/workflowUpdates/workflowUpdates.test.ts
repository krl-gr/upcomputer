import {
  INSTRUCTION_UPDATES,
  LEGACY_TASK_STATUSES,
  TASK_STATUSES,
  type InstructionUpdates,
} from "@t3tools/tasks-contracts/v1";
import { gtFallback } from "gt-react";
import { assert, describe, test } from "vite-plus/test";

import {
  DEFAULT_STATUS_GROUP_ORDER,
  LEGACY_STATUS_GROUP_ORDER,
} from "@t3tools/tasks-client/taskStatusGroups";
import { beforeAfterListLines } from "./BeforeAfterText.tsx";
import { instructionUpdateCopy, instructionUpdatesNoticeDetail } from "./instructionUpdateCopy.ts";
import { instructionUpdatesView, withInstructionUpdates } from "./workflowUpdates.ts";

const ENTRY = "task-statuses-v2";
const status = (
  id: string,
  state: InstructionUpdates["entries"][number]["state"],
  decidedAt: string | null = null,
) => ({ id, state, decidedAt, decidedBy: null, touchesEditedText: false });

describe("instructionUpdatesView", () => {
  test("leaves out entries the install had from the start and ones this build lacks", () => {
    const view = instructionUpdatesView({
      mode: "ask",
      entries: [status(ENTRY, "applied"), status("from-a-newer-build", "pending")],
    });
    assert.deepStrictEqual(view.entries, []);
    assert.deepStrictEqual(view.notice, []);
  });

  test("the bell holds pending entries; dismissed ones wait in Settings only", () => {
    const pending = instructionUpdatesView({ mode: "ask", entries: [status(ENTRY, "pending")] });
    assert.strictEqual(pending.notice.length, 1);
    const dismissed = instructionUpdatesView({
      mode: "ask",
      entries: [status(ENTRY, "dismissed")],
    });
    assert.strictEqual(dismissed.notice.length, 0);
    assert.strictEqual(dismissed.pending.length, 1);
    const applied = instructionUpdatesView({
      mode: "ask",
      entries: [status(ENTRY, "applied", "2026-11-23T08:00:00.000Z")],
    });
    assert.strictEqual(applied.entries.length, 1);
    assert.strictEqual(applied.pending.length, 0);
  });

  test("a local change applies as the server does: an applied entry stays applied", () => {
    const next = withInstructionUpdates(
      { mode: "ask", entries: [status(ENTRY, "applied", "2026-11-23T08:00:00.000Z")] },
      { mode: "auto", entries: [{ id: ENTRY, state: "kept" }] },
    );
    assert.strictEqual(next.mode, "auto");
    assert.strictEqual(next.entries[0]?.state, "applied");
  });
});

describe("entry copy", () => {
  // Without copy an entry shows its English text in every language.
  test("every entry has translatable copy matching its English text", () => {
    for (const entry of INSTRUCTION_UPDATES) {
      const copy = instructionUpdateCopy(gtFallback, entry);
      assert.deepStrictEqual(
        { title: copy.title, summary: copy.summary, why: copy.why },
        { title: entry.title, summary: entry.summary, why: entry.why },
        entry.id,
      );
    }
  });
});

describe("the bell's card", () => {
  const notice = (mode: "ask" | "auto", ...statuses: ReturnType<typeof status>[]) =>
    instructionUpdatesNoticeDetail(gtFallback, instructionUpdatesView({ mode, entries: statuses }));

  test("says what waits for whom in the install's mode", () => {
    const touching = { ...status(ENTRY, "pending"), touchesEditedText: true };
    assert.include(notice("ask", status(ENTRY, "pending")), "Nothing changes until you decide.");
    // In Apply automatically mode the rest applied by itself; this one waits for a reason.
    assert.notInclude(notice("auto", touching), "Nothing changes until you decide");
    assert.include(notice("auto", touching), "changes your own text, so it waits for you");
    const waiting = { ...status("bot-vs-worker-agent-creation", "pending"), waitsFor: ENTRY };
    assert.include(
      notice("auto", waiting),
      "applies by itself once “We updated how task statuses work” is applied",
    );
    // Before any decision only the first touches edited text; the second waits for it.
    assert.notInclude(notice("auto", touching, waiting), "These change your own text");
    assert.include(
      notice("auto", touching, waiting),
      "Some change your own text, and the rest build on those",
    );
    const touchingBoth = { ...waiting, touchesEditedText: true };
    assert.include(notice("auto", touching, touchingBoth), "These change your own text");
    // After "Keep mine" the second builds on the kept one; it did not touch the user's text.
    const kept = {
      ...status("bot-vs-worker-agent-creation", "pending"),
      touchesEditedText: true,
      keptFrom: ENTRY,
    };
    assert.notInclude(notice("auto", kept), "changes your own text");
    assert.include(
      notice("auto", kept),
      "builds on “We updated how task statuses work”, which you kept, so it waits for you",
    );
  });
});

describe("before and after lists", () => {
  test("mark added and removed names; a name that only moved is not marked", () => {
    const lines = beforeAfterListLines(LEGACY_STATUS_GROUP_ORDER, DEFAULT_STATUS_GROUP_ORDER, {
      Failed: "new",
    });
    const changed = (side: typeof lines.before) =>
      side.filter((line) => line.changed).map((line) => line.text);
    assert.deepStrictEqual(changed(lines.before), ["Needs Input", "Needs Review", "Backlog"]);
    assert.deepStrictEqual(changed(lines.after), [
      "Needs You",
      "Failed: new",
      "Queued",
      "To Verify",
    ]);
  });

  // The Tasks list's default order is shipped steering too: it changes only with an entry.
  test("the group order changes chain from workflow 1's to today's default", () => {
    let order: ReadonlyArray<string> = LEGACY_STATUS_GROUP_ORDER;
    for (const entry of INSTRUCTION_UPDATES)
      for (const change of entry.changes)
        if (change.kind === "groupOrder") {
          assert.deepStrictEqual(change.before, order, entry.id);
          order = change.after;
        }
    assert.deepStrictEqual(order, DEFAULT_STATUS_GROUP_ORDER);
    assert.sameMembers([...order], [...TASK_STATUSES]);
    assert.sameMembers([...LEGACY_STATUS_GROUP_ORDER], [...LEGACY_TASK_STATUSES]);
  });
});
