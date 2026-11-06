import { describe, expect, it } from "vite-plus/test";

import { nextArrivals, type ArrivalBaseline } from "./taskArrivals.ts";

const step = (
  baseline: ArrivalBaseline | null,
  keys: ReadonlyArray<string>,
  scope = "all",
  loadingMore = false,
) => nextArrivals(baseline, keys, scope, loadingMore);

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
});
