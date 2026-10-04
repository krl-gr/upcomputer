import { EnvironmentId } from "@t3tools/contracts";
import { EnvironmentRpcUnavailableError } from "@t3tools/client-runtime/rpc";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const rpc = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("../../../apps/web/src/extensionApi.ts", () => ({
  requestExperimentalFeatureRpc: rpc.request,
}));

import { readTasksWebAccess } from "./environmentApi.ts";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  rpc.request.mockReset();
  vi.useRealTimers();
});

describe("Tasks access", () => {
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
