import { EnvironmentId } from "@t3tools/contracts";
import { EnvironmentRpcUnavailableError } from "@t3tools/client-runtime/rpc";
import { createElement } from "react";
import { create } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const rpc = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("../../../apps/web/src/extensionApi.ts", () => ({
  requestExperimentalFeatureRpc: rpc.request,
}));

import {
  readPlannerAvailability,
  readTasksWebAccess,
  usePlannerAvailability,
  useTasksWebAccess,
} from "./environmentApi.ts";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  rpc.request.mockReset();
  vi.useRealTimers();
});

describe("Tasks access", () => {
  it("reaches a bot view when access resolves before React subscribes", async () => {
    rpc.request.mockResolvedValueOnce({ runCounts: [] });
    const environmentId = EnvironmentId.make("bots-answers-before-subscribe");
    const seen: boolean[] = [];
    let reachEnabled = () => {};
    const enabled = new Promise<void>((resolve) => {
      reachEnabled = resolve;
    });
    function View() {
      const access = useTasksWebAccess(environmentId);
      seen.push(access.canReadAgents);
      if (access.canReadAgents) reachEnabled();
      return null;
    }
    const view = create(createElement(View));
    await enabled;
    expect(seen[0]).toBe(false);
    expect(seen.at(-1)).toBe(true);
    view.unmount();
  });

  it("is enabled once the server answers the Tasks RPC group", async () => {
    rpc.request.mockResolvedValue({ runCounts: [] });
    const environmentId = EnvironmentId.make("environment-with-tasks");
    expect(readTasksWebAccess(environmentId).availability).toBe("loading");
    await settle();
    expect(readTasksWebAccess(environmentId)).toMatchObject({
      availability: "enabled",
      canReadTasks: true,
      canMutateAutomations: true,
    });
    expect(rpc.request).toHaveBeenCalledTimes(1);
  });

  it("is unavailable when the server rejects the Tasks RPC group", async () => {
    rpc.request.mockRejectedValue(new Error("Unknown request tag"));
    const environmentId = EnvironmentId.make("environment-without-tasks");
    readTasksWebAccess(environmentId);
    await settle();
    expect(readTasksWebAccess(environmentId)).toMatchObject({
      availability: "unavailable",
      canReadTasks: false,
    });
  });

  it("asks again after a disconnected environment comes back", async () => {
    vi.useFakeTimers();
    rpc.request.mockRejectedValueOnce(
      new EnvironmentRpcUnavailableError({ environmentId: "remote", message: "not connected" }),
    );
    rpc.request.mockResolvedValueOnce({ runCounts: [] });
    const environmentId = EnvironmentId.make("environment-reconnecting");
    readTasksWebAccess(environmentId);
    await vi.advanceTimersByTimeAsync(0);
    expect(readTasksWebAccess(environmentId).availability).toBe("loading");
    await vi.advanceTimersByTimeAsync(2_000);
    readTasksWebAccess(environmentId);
    await vi.advanceTimersByTimeAsync(0);
    expect(readTasksWebAccess(environmentId).availability).toBe("enabled");
    expect(rpc.request).toHaveBeenCalledTimes(2);
  });
});

describe("Planner availability", () => {
  it("is enabled when the server answers the schedule range and unavailable when it rejects it", async () => {
    rpc.request.mockResolvedValueOnce({ entries: [], tasks: [] });
    rpc.request.mockRejectedValueOnce(new Error("Unknown request tag"));
    const current = EnvironmentId.make("planner-current");
    const older = EnvironmentId.make("planner-older-server");
    expect(readPlannerAvailability(current)).toBe("loading");
    expect(readPlannerAvailability(older)).toBe("loading");
    await settle();
    expect(readPlannerAvailability(current)).toBe("enabled");
    expect(readPlannerAvailability(older)).toBe("unavailable");
    expect(rpc.request).toHaveBeenCalledTimes(2);
  });

  it("reaches a view when the probe answers before the view subscribes", async () => {
    rpc.request.mockResolvedValueOnce({ entries: [], tasks: [] });
    const environmentId = EnvironmentId.make("planner-answers-before-subscribe");
    const seen: Array<string | null> = [];
    let reachEnabled = () => {};
    const enabled = new Promise<void>((resolve) => {
      reachEnabled = resolve;
    });
    function View() {
      const availability = usePlannerAvailability(environmentId);
      seen.push(availability);
      if (availability === "enabled") reachEnabled();
      return null;
    }
    // Outside act, as in the browser: the render starts the probe, its answer
    // lands in a microtask, and React subscribes later in a passive effect and
    // renders again from its scheduler. A view the answer never reaches stays
    // "loading" and fails this test on its timeout.
    const view = create(createElement(View));
    await enabled;
    expect(seen[0]).toBe("loading");
    expect(seen.at(-1)).toBe("enabled");
    view.unmount();
  });
});
