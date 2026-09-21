import * as NodeV8 from "node:v8";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";

export interface BackendMemorySample {
  readonly pid: number;
  readonly uptimeSeconds: number;
  readonly rssBytes: number;
  readonly heapUsedBytes: number;
  readonly heapTotalBytes: number;
  readonly heapLimitBytes: number;
  readonly externalBytes: number;
  readonly arrayBufferBytes: number;
}

// Numeric process counters only: no heap dumps, prompts, tool output or credentials.
export function readBackendMemorySample(): BackendMemorySample {
  const memory = process.memoryUsage();
  return {
    pid: process.pid,
    uptimeSeconds: Math.floor(process.uptime()),
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    heapTotalBytes: memory.heapTotal,
    heapLimitBytes: NodeV8.getHeapStatistics().heap_size_limit,
    externalBytes: memory.external,
    arrayBufferBytes: memory.arrayBuffers,
  };
}

export function isHeapPressure(sample: BackendMemorySample): boolean {
  return sample.heapUsedBytes >= sample.heapLimitBytes * 0.8;
}

export const startBackendMemoryDiagnostics = Effect.fn("startBackendMemoryDiagnostics")(function* (
  readSample: () => BackendMemorySample = readBackendMemorySample,
) {
  yield* Effect.sync(readSample).pipe(
    Effect.flatMap((sample) =>
      isHeapPressure(sample)
        ? Effect.logWarning("backend memory pressure", sample)
        : Effect.logInfo("backend memory sample", sample),
    ),
    Effect.repeat(Schedule.spaced("60 seconds")),
    Effect.forkScoped,
  );
});
