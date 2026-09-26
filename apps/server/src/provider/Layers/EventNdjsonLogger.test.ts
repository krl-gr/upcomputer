// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { ThreadId } from "@upcomputer/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Logger from "effect/Logger";
import * as Schema from "effect/Schema";

import { makeEventNdjsonLogger } from "./EventNdjsonLogger.ts";

const encodeUnknownJson = Schema.encodeUnknownSync(Schema.UnknownFromJsonString);
const decodeUnknownJson = Schema.decodeUnknownSync(Schema.UnknownFromJsonString);

function parseLogLine(line: string) {
  const match = /^\[([^\]]+)\] ([A-Z]+): (.+)$/.exec(line);
  assert.notEqual(match, null);
  if (!match) {
    throw new Error(`invalid log line: ${line}`);
  }
  const observedAt = match[1];
  const stream = match[2];
  const payload = match[3];
  if (!observedAt || !stream || payload === undefined) {
    throw new Error(`invalid log line: ${line}`);
  }
  return {
    observedAt,
    stream,
    payload,
  };
}

describe("EventNdjsonLogger", () => {
  it.effect("summarizes circular events without exposing their contents in diagnostics", () => {
    const messages: Array<unknown> = [];
    const logCapture = Logger.make<unknown, void>(({ message }) => {
      if (Array.isArray(message)) {
        messages.push(...message);
      } else {
        messages.push(message);
      }
    });
    const secret = "secret-circular-event-value";

    return Effect.gen(function* () {
      const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-provider-log-"));
      const basePath = NodePath.join(tempDir, "provider-native.ndjson");
      const circular: Record<string, unknown> = { secret };
      circular.self = circular;

      try {
        const logger = yield* makeEventNdjsonLogger(basePath, { stream: "native" });
        assert.exists(logger);
        if (!logger) return;
        yield* logger.write(circular, ThreadId.make("thread-1"));
        yield* logger.close();

        const serialized = encodeUnknownJson(messages);
        assert.notInclude(serialized, secret);
        const line = parseLogLine(
          NodeFS.readFileSync(NodePath.join(tempDir, "thread-1.log"), "utf8").trim(),
        );
        assert.equal(line.payload, '{"truncated":true}');
      } finally {
        NodeFS.rmSync(tempDir, { recursive: true, force: true });
      }
    }).pipe(Effect.provide(Logger.layer([logCapture], { mergeWithExisting: false })));
  });

  it.effect("summarizes large histories without reading their items", () =>
    Effect.gen(function* () {
      const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-provider-log-"));
      const basePath = NodePath.join(tempDir, "provider-native.ndjson");
      const turns = Array.from({ length: 10_000 });
      Object.defineProperty(turns, 0, {
        get: () => {
          throw new Error("history must not be serialized");
        },
      });

      try {
        const logger = yield* makeEventNdjsonLogger(basePath, { stream: "native" });
        assert.exists(logger);
        if (!logger) return;
        yield* logger.write(
          {
            provider: "codex",
            event: {
              direction: "incoming",
              stage: "decoded",
              payload: { id: 42, result: { thread: { id: "native-thread", turns } } },
            },
          },
          ThreadId.make("large-history"),
        );
        yield* logger.close();

        const contents = NodeFS.readFileSync(NodePath.join(tempDir, "large-history.log"), "utf8");
        assert.isBelow(Buffer.byteLength(contents), 2_048);
        const record = decodeUnknownJson(parseLogLine(contents.trim()).payload);
        assert.nestedPropertyVal(record, "event.payload.id", 42);
        assert.nestedPropertyVal(record, "event.payload.result.thread.id", "native-thread");
        assert.nestedPropertyVal(record, "event.payload.result.thread.turns.itemCount", 10_000);
      } finally {
        NodeFS.rmSync(tempDir, { recursive: true, force: true });
      }
    }),
  );

  it.effect("bounds oversized records while retaining failure details", () =>
    Effect.gen(function* () {
      const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-provider-log-"));
      const basePath = NodePath.join(tempDir, "provider-native.ndjson");

      try {
        const logger = yield* makeEventNdjsonLogger(basePath, { stream: "native" });
        assert.exists(logger);
        if (!logger) return;
        const threadId = ThreadId.make("large-error");
        const failure = {
          method: "error",
          params: {
            threadId: "native-thread",
            turnId: "native-turn",
            error: { message: "The provider is unavailable.", code: "overloaded" },
            output: "x".repeat(128 * 1_024),
          },
        };
        yield* logger.write(failure, threadId);
        yield* logger.write({ id: "escaped", output: "\u0000".repeat(20_000) }, threadId);
        yield* logger.close();

        const contents = NodeFS.readFileSync(NodePath.join(tempDir, "large-error.log"), "utf8");
        const records = contents
          .trim()
          .split("\n")
          .map((line) => decodeUnknownJson(parseLogLine(line).payload));
        assert.isBelow(Buffer.byteLength(contents), 64 * 1_024);
        assert.equal(records.length, 2);
        assert.nestedPropertyVal(records[0], "params.threadId", "native-thread");
        assert.nestedPropertyVal(records[0], "params.turnId", "native-turn");
        assert.nestedPropertyVal(
          records[0],
          "params.error.message",
          "The provider is unavailable.",
        );
        assert.nestedPropertyVal(records[0], "params.error.code", "overloaded");
        assert.propertyVal(records[1], "id", "escaped");
      } finally {
        NodeFS.rmSync(tempDir, { recursive: true, force: true });
      }
    }),
  );

  it.effect("bounds canonical diff snapshots before serializing their duplicate payloads", () =>
    Effect.gen(function* () {
      const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-provider-log-"));
      const basePath = NodePath.join(tempDir, "provider-canonical.ndjson");
      const threadId = ThreadId.make("large-diff");
      const diff = "diff-payload".repeat(128 * 1_024);
      try {
        const logger = yield* makeEventNdjsonLogger(basePath, {
          stream: "canonical",
          batchWindowMs: 0,
        });
        assert.exists(logger);
        if (!logger) return;
        yield* logger.write(
          {
            type: "turn.diff.updated",
            threadId,
            turnId: "native-turn",
            raw: { method: "turn/diff/updated", payload: { diff } },
            payload: { unifiedDiff: diff },
          },
          threadId,
        );
        yield* logger.close();
        const contents = NodeFS.readFileSync(NodePath.join(tempDir, "large-diff.log"), "utf8");
        assert.isBelow(Buffer.byteLength(contents), 2_048);
        const record = decodeUnknownJson(parseLogLine(contents.trim()).payload);
        assert.propertyVal(record, "type", "turn.diff.updated");
        assert.propertyVal(record, "threadId", threadId);
        assert.propertyVal(record, "turnId", "native-turn");
      } finally {
        NodeFS.rmSync(tempDir, { recursive: true, force: true });
      }
    }),
  );

  it.effect("writes effect-style lines to thread-scoped files", () =>
    Effect.gen(function* () {
      const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-provider-log-"));
      const basePath = NodePath.join(tempDir, "provider-native.ndjson");

      try {
        const logger = yield* makeEventNdjsonLogger(basePath, { stream: "native" });
        assert.notEqual(logger, undefined);
        if (!logger) {
          return;
        }

        yield* logger.write(
          { threadId: "provider-thread-1", id: "evt-1" },
          ThreadId.make("thread-1"),
        );
        yield* logger.write(
          { type: "turn.completed", threadId: "provider-thread-2", id: "evt-2" },
          ThreadId.make("thread-2"),
        );
        yield* logger.close();

        const threadOnePath = NodePath.join(tempDir, "thread-1.log");
        const threadTwoPath = NodePath.join(tempDir, "thread-2.log");
        assert.equal(NodeFS.existsSync(threadOnePath), true);
        assert.equal(NodeFS.existsSync(threadTwoPath), true);

        const first = parseLogLine(NodeFS.readFileSync(threadOnePath, "utf8").trim());
        const second = parseLogLine(NodeFS.readFileSync(threadTwoPath, "utf8").trim());

        assert.equal(Number.isNaN(Date.parse(first.observedAt)), false);
        assert.equal(first.stream, "NTIVE");
        assert.equal(first.payload, '{"threadId":"provider-thread-1","id":"evt-1"}');

        assert.equal(Number.isNaN(Date.parse(second.observedAt)), false);
        assert.equal(second.stream, "NTIVE");
        assert.equal(
          second.payload,
          '{"type":"turn.completed","threadId":"provider-thread-2","id":"evt-2"}',
        );
      } finally {
        NodeFS.rmSync(tempDir, { recursive: true, force: true });
      }
    }),
  );

  it.effect(
    "falls back to a global segment when orchestration thread id is missing or invalid",
    () =>
      Effect.gen(function* () {
        const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-provider-log-"));
        const basePath = NodePath.join(tempDir, "provider-canonical.ndjson");

        try {
          const logger = yield* makeEventNdjsonLogger(basePath, { stream: "orchestration" });
          assert.notEqual(logger, undefined);
          if (!logger) {
            return;
          }

          yield* logger.write({ id: "evt-no-thread" }, null);
          yield* logger.write({ id: "evt-invalid-thread" }, "!!!" as unknown as ThreadId);
          yield* logger.close();

          const globalPath = NodePath.join(tempDir, "_global.log");
          assert.equal(NodeFS.existsSync(globalPath), true);
          const lines = NodeFS.readFileSync(globalPath, "utf8")
            .trim()
            .split("\n")
            .map((line) => parseLogLine(line));
          assert.equal(lines.length, 2);
          assert.equal(Number.isNaN(Date.parse(lines[0]?.observedAt ?? "")), false);
          assert.equal(Number.isNaN(Date.parse(lines[1]?.observedAt ?? "")), false);
          assert.equal(lines[0]?.stream, "CANON");
          assert.equal(lines[0]?.payload, '{"id":"evt-no-thread"}');
          assert.equal(lines[1]?.stream, "CANON");
          assert.equal(lines[1]?.payload, '{"id":"evt-invalid-thread"}');
        } finally {
          NodeFS.rmSync(tempDir, { recursive: true, force: true });
        }
      }),
  );

  it.effect("serializes concurrent first writes for the same segment", () =>
    Effect.gen(function* () {
      const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-provider-log-"));
      const basePath = NodePath.join(tempDir, "provider-canonical.ndjson");

      try {
        const logger = yield* makeEventNdjsonLogger(basePath, {
          stream: "canonical",
          batchWindowMs: 0,
        });
        assert.notEqual(logger, undefined);
        if (!logger) {
          return;
        }

        yield* Effect.all(
          [
            logger.write({ id: "evt-concurrent-1" }, null),
            logger.write({ id: "evt-concurrent-2" }, null),
          ],
          { concurrency: "unbounded" },
        );
        yield* logger.close();

        const globalPath = NodePath.join(tempDir, "_global.log");
        assert.equal(NodeFS.existsSync(globalPath), true);
        const lines = NodeFS.readFileSync(globalPath, "utf8")
          .trim()
          .split("\n")
          .map((line) => parseLogLine(line));

        assert.equal(lines.length, 2);
        assert.deepEqual(lines.map((line) => line.payload).toSorted(), [
          '{"id":"evt-concurrent-1"}',
          '{"id":"evt-concurrent-2"}',
        ]);
      } finally {
        NodeFS.rmSync(tempDir, { recursive: true, force: true });
      }
    }),
  );

  it.effect("rotates per-thread files when max size is exceeded", () =>
    Effect.gen(function* () {
      const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-provider-log-"));
      const basePath = NodePath.join(tempDir, "provider-native.ndjson");

      try {
        const logger = yield* makeEventNdjsonLogger(basePath, {
          stream: "native",
          maxBytes: 120,
          maxFiles: 2,
        });
        assert.notEqual(logger, undefined);
        if (!logger) {
          return;
        }

        for (let index = 0; index < 10; index += 1) {
          yield* logger.write(
            {
              threadId: "provider-thread-rotate",
              id: `evt-${index}`,
              payload: "x".repeat(40),
            },
            ThreadId.make("thread-rotate"),
          );
        }
        yield* logger.close();

        const fileStem = "thread-rotate.log";
        const matchingFiles = NodeFS.readdirSync(tempDir)
          .filter((entry) => entry === fileStem || entry.startsWith(`${fileStem}.`))
          .toSorted();

        assert.equal(
          matchingFiles.some((entry) => entry === `${fileStem}.1`),
          true,
        );
        assert.equal(
          matchingFiles.some((entry) => entry === fileStem || entry === `${fileStem}.2`),
          true,
        );
        assert.equal(
          matchingFiles.some((entry) => entry === `${fileStem}.3`),
          false,
        );
      } finally {
        NodeFS.rmSync(tempDir, { recursive: true, force: true });
      }
    }),
  );
});
