import { assert, it } from "@effect/vitest";
import {
  NodeId,
  ProviderDriverKind,
  ProviderThreadId,
  ProviderTurnId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import {
  makeProviderFailure,
  makeProviderFailureTurnItem,
  providerFailureTitle,
  MAX_PROVIDER_FAILURE_CODE_LENGTH,
  MAX_PROVIDER_FAILURE_MESSAGE_LENGTH,
  ContextHandoffBudgetError,
} from "./failure.ts";
import * as IdAllocator from "./IdAllocator.ts";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

it("redacts credentials and URL secrets from provider failures", () => {
  const failure = makeProviderFailure({
    message:
      'request failed: Authorization: Bearer bearer-secret https://user:pass@example.test/path?access_token=url-secret#fragment {"token":"json-secret"} api_key=key-secret sk-abcdefghijklmnop',
    code: "provider_rejected",
    class: "provider_error",
  });

  assert.equal(failure.class, "provider_error");
  assert.equal(failure.code, "provider_rejected");
  assert.include(failure.message, "[REDACTED]");
  assert.include(failure.message, "https://example.test/path");
  assert.notInclude(failure.message, "bearer-secret");
  assert.notInclude(failure.message, "user:pass");
  assert.notInclude(failure.message, "url-secret");
  assert.notInclude(failure.message, "json-secret");
  assert.notInclude(failure.message, "key-secret");
  assert.notInclude(failure.message, "sk-abcdefghijklmnop");
});

it("replaces unsafe control characters without stripping whitespace", () => {
  const failure = makeProviderFailure({ message: "before\u0000\u0007\t\nafter\u007f" });

  assert.equal(failure.message, "before  \t\nafter");
});

it("bounds provider-controlled failure strings", () => {
  const failure = makeProviderFailure({
    message: "m".repeat(MAX_PROVIDER_FAILURE_MESSAGE_LENGTH + 500),
    code: "c".repeat(MAX_PROVIDER_FAILURE_CODE_LENGTH + 50),
  });

  assert.equal(failure.message.length, MAX_PROVIDER_FAILURE_MESSAGE_LENGTH);
  assert.equal(failure.code?.length, MAX_PROVIDER_FAILURE_CODE_LENGTH);
  assert.match(failure.message, /…$/u);
  assert.match(failure.code ?? "", /…$/u);
});

it("does not split a surrogate pair at the truncation boundary", () => {
  const failure = makeProviderFailure({
    message: `${"a".repeat(MAX_PROVIDER_FAILURE_MESSAGE_LENGTH - 2)}🚀tail`,
  });

  assert.equal(failure.message.length, MAX_PROVIDER_FAILURE_MESSAGE_LENGTH - 1);
  assert.equal(failure.message.at(-1), "…");
  assert.notMatch(failure.message.slice(0, -1), /[\uD800-\uDBFF]$/u);
});

const UNEXPLAINED =
  "The agent stopped with an error it didn't explain. Send the message again; if it repeats, check The agent in Settings.";

it("keeps arbitrary cause messages out of the main message and in the detail", () => {
  const cause = new Error("Adapter failed", {
    cause: new Error("Session expired. Sign in again."),
  });
  for (const value of [
    cause,
    Cause.fail(cause),
    "Session expired. Sign in again.",
    { message: "Session expired. Sign in again." },
  ]) {
    const failure = makeProviderFailure({ cause: value });
    assert.equal(failure.message, UNEXPLAINED);
    assert.include(failure.detail ?? "", "Session expired. Sign in again.");
    assert.equal(
      makeProviderFailure({ cause: value, message: "Provider connection closed." }).message,
      "Provider connection closed.",
    );
  }
});

it("preserves actionable handoff errors wrapped by turn startup", () => {
  const cause = new ProviderAdapter.ProviderAdapterTurnStartError({
    driver: ProviderDriverKind.make("codex"),
    threadId: ThreadId.make("thread:handoff-error"),
    providerThreadId: ProviderThreadId.make("provider-thread:handoff-error"),
    runId: RunId.make("run:handoff-error"),
    cause: new ContextHandoffBudgetError(),
  });
  assert.equal(
    makeProviderFailure({ cause: Cause.fail(cause) }).message,
    new ContextHandoffBudgetError().message,
  );
});

it("does not expose defect text nested inside a known error category", () => {
  const failure = makeProviderFailure({
    cause: {
      _tag: "ProviderAdapterEventStreamError",
      cause: new Error(
        `Session rejected: Bearer nested-secret https://user:pass@example.test/path?token=secret ${"x".repeat(5000)}`,
      ),
    },
  });
  assert.include(failure.message, "dropped while it was working");
  assert.equal(failure.code, "connection_lost");
  assert.notInclude(failure.message, "Session rejected:");
  assert.notInclude(failure.message, "nested-secret");
  assert.include(failure.detail ?? "", "Session rejected:");
  for (const secret of ["nested-secret", "user:pass", "token=secret"]) {
    assert.notInclude(failure.message, secret);
    assert.notInclude(failure.detail ?? "", secret);
  }
  assert.isBelow(failure.message.length, MAX_PROVIDER_FAILURE_MESSAGE_LENGTH);
  assert.isAtMost(failure.detail?.length ?? 0, MAX_PROVIDER_FAILURE_MESSAGE_LENGTH);
});

it("handles cyclic causes and throwing accessors", () => {
  const cyclic: { message: string; cause?: unknown } = {
    message: "Provider disconnected. Retry the turn.",
  };
  cyclic.cause = cyclic;
  assert.equal(makeProviderFailure({ cause: cyclic }).message, UNEXPLAINED);
  assert.equal(
    makeProviderFailure({
      cause: {
        get message() {
          throw new Error("unreadable");
        },
        get cause() {
          throw new Error("unreadable");
        },
      },
    }).message,
    UNEXPLAINED,
  );
});

it("falls back when inspecting a provider cause throws", () => {
  const cause = new Proxy(
    {},
    {
      has() {
        throw new Error("unreadable provider cause");
      },
    },
  );
  assert.equal(makeProviderFailure({ cause }).message, UNEXPLAINED);
});

it("does not serialize arbitrary provider causes", () => {
  const failure = makeProviderFailure({
    cause: {
      payload: { authorization: "Bearer nested-secret" },
      stack: "private provider stack",
    },
    class: "transport_error",
  });

  assert.deepEqual(failure, {
    class: "transport_error",
    message: UNEXPLAINED,
    code: null,
    retryable: null,
  });
});

it("names the provider and keeps its typed reason in the main message", () => {
  const driver = ProviderDriverKind.make("opencode");
  const failure = makeProviderFailure({
    driver,
    class: "provider_error",
    cause: {
      _tag: "OpenCodeRuntimeError",
      detail: "OpenCode command admission did not complete within 10 seconds.",
      cause: new Error("socket hang up"),
    },
  });
  assert.equal(
    failure.message,
    "OpenCode stopped before finishing: OpenCode command admission did not complete within 10 seconds. Send the message again; if it keeps happening, check OpenCode in Settings.",
  );
  assert.include(failure.detail ?? "", "socket hang up");
  assert.equal(providerFailureTitle(failure, driver), "OpenCode stopped with an error");
});

it("explains why a session could not open instead of leaking its internal id", () => {
  const driver = ProviderDriverKind.make("codex");
  const failure = makeProviderFailure({
    driver,
    cause: {
      _tag: "ProviderAdapterOpenSessionError",
      message: "Failed to open codex provider session ps_123.",
      cause: {
        _tag: "ProviderSetupError",
        detail: "Set up managed Codex before starting a session.",
      },
    },
  });
  assert.equal(
    failure.message,
    "Codex couldn't start: set up managed Codex before starting a session. Check Codex in Settings, then send the message again.",
  );
  assert.notInclude(failure.message, "ps_123");
  assert.equal(failure.code, "session_open_failed");
  assert.equal(providerFailureTitle(failure, driver), "Couldn't start Codex");
});

it("reads the exit code of a crashed ACP agent and keeps stderr for the details", () => {
  const failure = makeProviderFailure({
    driver: ProviderDriverKind.make("grok"),
    cause: { _tag: "AcpProcessExitedError", code: 3, stderr: "panic: out of cheese" },
  });
  assert.equal(
    failure.message,
    "Grok stopped before finishing: it quit with exit code 3. Send the message again; if it keeps happening, check Grok in Settings.",
  );
  assert.include(failure.detail ?? "", "panic: out of cheese");
});

it("says attachments and compaction failures will not get better by retrying", () => {
  const attachment = makeProviderFailure({
    driver: ProviderDriverKind.make("claudeAgent"),
    cause: {
      _tag: "ProviderAdapterTurnStartError",
      cause: {
        _tag: "ProviderAdapterProtocolError",
        detail: "Unsupported Claude image attachment type 'image/heic'",
      },
    },
  });
  assert.equal(attachment.code, "attachment_unsupported");
  assert.equal(attachment.retryable, false);
  assert.include(attachment.message, "can't read this attachment");

  const compact = makeProviderFailure({
    cause: {
      _tag: "ProviderAdapterTurnStartError",
      cause: {
        _tag: "ProviderAdapterProtocolError",
        detail: "This provider does not support context compaction.",
      },
    },
  });
  assert.equal(compact.code, "compact_unsupported");
  assert.equal(compact.retryable, false);
});

it("titles usage limits after the provider", () => {
  const failure = makeProviderFailure({ class: "usage_limit", message: "Limit reached." });
  assert.equal(
    providerFailureTitle(failure, ProviderDriverKind.make("cursor")),
    "Cursor usage limit reached",
  );
  assert.equal(providerFailureTitle(failure, undefined), "Agent usage limit reached");
});

it.effect("keys terminal failure items by provider turn across retries and fallback paths", () =>
  Effect.gen(function* () {
    const idAllocator = yield* IdAllocator.IdAllocatorV2;
    const driver = ProviderDriverKind.make("codex");
    const runId = RunId.make("run:provider-failure-id");
    const base = {
      idAllocator,
      driver,
      threadId: ThreadId.make("thread:provider-failure-id"),
      runId,
      nodeId: NodeId.make("node:provider-failure-id"),
      providerThreadId: ProviderThreadId.make("provider-thread:provider-failure-id"),
      itemOrdinal: 101,
      failure: makeProviderFailure({ message: "Provider failed" }),
      occurredAt: DateTime.makeUnsafe("2026-06-22T12:00:00.000Z"),
    } as const;
    const firstTurnId = ProviderTurnId.make("provider-turn:provider-failure-id:first");
    const secondTurnId = ProviderTurnId.make("provider-turn:provider-failure-id:second");

    const firstAttempt = makeProviderFailureTurnItem({
      ...base,
      providerTurnId: firstTurnId,
    });
    const retriedAttempt = makeProviderFailureTurnItem({
      ...base,
      providerTurnId: secondTurnId,
    });
    const ingestorFallback = makeProviderFailureTurnItem({
      ...base,
      runId: null,
      nodeId: null,
      providerTurnId: firstTurnId,
    });

    assert.notEqual(firstAttempt.id, retriedAttempt.id);
    assert.equal(firstAttempt.id, ingestorFallback.id);
    assert.equal(firstAttempt.ordinal, 101);
  }).pipe(Effect.provide(IdAllocator.layer)),
);
