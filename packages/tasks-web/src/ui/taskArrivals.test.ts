import { describe, expect, it } from "vite-plus/test";

import { nextArrivals, type ArrivalBaseline } from "./taskArrivals.ts";

const LIST: ReadonlySet<string> = new Set([""]);
const step = (
  baseline: ArrivalBaseline | null,
  keys: ReadonlyArray<string>,
  scope = "all",
  loadingMore = false,
) =>
  nextArrivals(
    baseline,
    keys.map((key) => ({ key, group: "" })),
    scope,
    loadingMore,
    LIST,
  );

/** Rows as `group:key`, and the groups that are open with their rows loaded. */
const grouped = (
  baseline: ArrivalBaseline | null,
  rows: ReadonlyArray<string>,
  readyGroups: ReadonlyArray<string>,
) =>
  nextArrivals(
    baseline,
    rows.map((row) => ({ key: row, group: row.split(":")[0]! })),
    "all",
    false,
    new Set(readyGroups),
  );

describe("nextArrivals", () => {
  it("marks a task that shows up in the same scope", () => {
    const first = step(null, ["a", "b"]);
    expect(first.arrived).toEqual([]);
    expect(step(first.baseline, ["new", "a", "b"]).arrived).toEqual(["new"]);
  });

  it("takes a new scope, such as another project filter, as the baseline", () => {
    const first = step(null, ["a"], "[null,{}]");
    expect(step(first.baseline, ["b", "c"], '["project",{}]').arrived).toEqual([]);
  });

  it("treats rows a requested page brings as already seen", () => {
    const first = step(null, ["a"]);
    const requested = step(first.baseline, ["a"], "all", true);
    // The page lands with the same update that ends the request.
    const landed = step(requested.baseline, ["a", "old-1", "old-2"]);
    expect(landed.arrived).toEqual([]);
    expect(step(landed.baseline, ["new", "a", "old-1", "old-2"]).arrived).toEqual(["new"]);
  });

  it("never marks the rows a group brings as it opens, from a cache or the server", () => {
    const first = grouped(null, ["backlog:a"], ["backlog"]);
    // Done opens: its lane starts loading, then its rows land (or come at once from a cache).
    const opening = grouped(first.baseline, ["backlog:a"], ["backlog"]);
    const landed = grouped(
      opening.baseline,
      ["backlog:a", "done:x", "done:y"],
      ["backlog", "done"],
    );
    expect(landed.arrived).toEqual([]);
    // Closed and opened again, its rows were already seen.
    const closed = grouped(landed.baseline, ["backlog:a", "done:x", "done:y"], ["backlog"]);
    const reopened = grouped(
      closed.baseline,
      ["backlog:a", "done:x", "done:y"],
      ["backlog", "done"],
    );
    expect(reopened.arrived).toEqual([]);
    // A task created into an open group is new.
    const created = grouped(
      reopened.baseline,
      ["backlog:new", "backlog:a", "done:x", "done:y"],
      ["backlog", "done"],
    );
    expect(created.arrived).toEqual(["backlog:new"]);
  });

  it("treats rows a group's next page brings as already seen", () => {
    const first = grouped(null, ["done:a"], ["done"]);
    // The group is loading its next page, so it is not ready until the page lands.
    const loading = grouped(first.baseline, ["done:a"], []);
    expect(grouped(loading.baseline, ["done:a", "done:old"], ["done"]).arrived).toEqual([]);
  });
});
