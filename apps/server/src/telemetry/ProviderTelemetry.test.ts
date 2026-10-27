import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderInstallState,
  ProviderSessionId,
  ProviderSetupError,
  type ServerProvider,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as OpenCodeRuntime from "@t3tools/provider-opencode/server/OpenCodeRuntime";
import * as EffectAcpErrors from "effect-acp/errors";
import * as CodexErrors from "effect-codex-app-server/errors";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as AnalyticsService from "./AnalyticsService.ts";
import * as ProviderTelemetry from "./ProviderTelemetry.ts";

const missingClaude: ServerProvider = {
  driver: ProviderDriverKind.make("claudeAgent"),
  instanceId: ProviderInstanceId.make("claude-personal"),
  enabled: true,
  installed: false,
  version: null,
  status: "error",
  message: "Claude Agent CLI (`claude`) was not found on PATH.",
  checkedAt: "2026-10-17T00:00:00Z",
  auth: { status: "unknown" },
  models: [],
  skills: [],
  slashCommands: [],
};

const sessionId = ProviderSessionId.make("provider-session-1");
const instanceId = ProviderInstanceId.make("instance-1");

/** What the session manager hands the classifier: the adapter's open error. */
const openFailure = (driver: string, cause: unknown) =>
  new ProviderAdapter.ProviderAdapterOpenSessionError({
    driver: ProviderDriverKind.make(driver),
    providerSessionId: sessionId,
    cause,
  });

const spawnFailure = (tag: "NotFound" | "PermissionDenied") =>
  PlatformError.systemError({
    _tag: tag,
    module: "ChildProcess",
    method: "spawn",
    pathOrDescriptor: "/Users/someone/.local/bin/agent",
    cause: Object.assign(new Error("spawn agent ENOENT"), {
      code: tag === "NotFound" ? "ENOENT" : "EACCES",
      syscall: "spawn agent",
    }),
  });

const setupFailure = (operation: string) =>
  new ProviderSetupError({ instanceId, operation, detail: "Sign in again." });

const category = ProviderTelemetry.readinessErrorCategory;

describe("readinessErrorCategory", () => {
  it("classifies Claude open failures", () => {
    // The registry wraps a sign-in change; Claude itself spawns nothing until the first turn.
    assert.equal(
      category(openFailure("claudeAgent", setupFailure("session"))),
      "not_authenticated",
    );
    assert.equal(
      category(
        openFailure(
          "claudeAgent",
          Object.assign(new Error("spawn claude ENOENT"), {
            code: "ENOENT",
            syscall: "spawn claude",
          }),
        ),
      ),
      "cli_missing",
    );
    assert.equal(category(openFailure("claudeAgent", new Error("Not logged in"))), "unknown");
  });

  it("classifies Codex open failures, including the doubled open wrapper", () => {
    assert.equal(
      category(openFailure("codex", openFailure("codex", spawnFailure("NotFound")))),
      "cli_missing",
    );
    assert.equal(
      category(openFailure("codex", openFailure("codex", spawnFailure("PermissionDenied")))),
      "spawn_failed",
    );
    assert.equal(category(openFailure("codex", setupFailure("install"))), "cli_missing");
    assert.equal(category(openFailure("codex", setupFailure("access"))), "not_authenticated");
    assert.equal(category(openFailure("codex", setupFailure("refresh"))), "auth_expired");
    assert.equal(
      category(
        openFailure(
          "codex",
          new CodexErrors.CodexAppServerRequestError({ code: -32601, errorMessage: "no method" }),
        ),
      ),
      "version_unsupported",
    );
    assert.equal(
      category(
        openFailure(
          "codex",
          new CodexErrors.CodexAppServerSpawnError({ command: "codex", cause: "boom" }),
        ),
      ),
      "spawn_failed",
    );
  });

  it("classifies Grok open failures over ACP", () => {
    const spawn = (cause: unknown) =>
      openFailure("grok", new EffectAcpErrors.AcpSpawnError({ command: "grok", cause }));
    assert.equal(category(spawn(spawnFailure("NotFound"))), "cli_missing");
    assert.equal(category(spawn(new Error("spawn failed"))), "spawn_failed");
    assert.equal(
      category(
        openFailure(
          "grok",
          new EffectAcpErrors.AcpRequestError({
            code: -32000,
            errorMessage: "Authentication required",
          }),
        ),
      ),
      "not_authenticated",
    );
    assert.equal(
      category(
        openFailure(
          "grok",
          new EffectAcpErrors.AcpRequestError({ code: -32003, errorMessage: "Rate limited" }),
        ),
      ),
      "usage_limit",
    );
    assert.equal(
      category(openFailure("grok", new EffectAcpErrors.AcpProcessExitedError({ code: 9009 }))),
      "cli_missing",
    );
    assert.equal(
      category(openFailure("grok", new EffectAcpErrors.AcpProcessExitedError({ code: 1 }))),
      "spawn_failed",
    );
    assert.equal(
      category(
        openFailure(
          "grok",
          new EffectAcpErrors.AcpProtocolParseError({
            operation: "decode-wire-message",
            cause: "bad frame",
          }),
        ),
      ),
      "version_unsupported",
    );
    assert.equal(category(openFailure("grok", new Cause.TimeoutError())), "timeout");
  });

  it("classifies OpenCode open failures from their structured reason", () => {
    const runtime = (
      fields: ConstructorParameters<typeof OpenCodeRuntime.OpenCodeRuntimeError>[0],
    ) => openFailure("opencode", new OpenCodeRuntime.OpenCodeRuntimeError(fields));
    assert.equal(
      category(
        runtime({
          operation: "startOpenCodeServerProcess",
          detail: "Failed to spawn",
          cause: spawnFailure("NotFound"),
        }),
      ),
      "cli_missing",
    );
    assert.equal(
      category(runtime({ operation: "startOpenCodeServerProcess", detail: "exited early" })),
      "spawn_failed",
    );
    assert.equal(
      category(
        runtime({ operation: "global.health", detail: "too old", reason: "version_unsupported" }),
      ),
      "version_unsupported",
    );
    assert.equal(
      category(runtime({ operation: "server.info", detail: "Timed out", reason: "timeout" })),
      "timeout",
    );
    assert.equal(
      category(
        runtime({
          operation: "server.info",
          detail: "rejected",
          cause: { _tag: "UnauthorizedError" },
        }),
      ),
      "not_authenticated",
    );
    assert.equal(
      category(
        runtime({
          operation: "server.info",
          detail: "Could not reach the OpenCode server.",
          cause: {
            _tag: "ClientError",
            cause: { _tag: "HttpClientError", reason: { _tag: "TransportError" } },
          },
        }),
      ),
      "network",
    );
  });

  it("classifies Cursor open failures", () => {
    // Cursor opens lazily; the agent and API key are first used at turn start.
    assert.equal(category(openFailure("cursor", setupFailure("session"))), "not_authenticated");
    assert.equal(
      category(
        openFailure(
          "cursor",
          Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
        ),
      ),
      "network",
    );
    assert.equal(category(openFailure("cursor", new Error("boom"))), "unknown");
  });

  it("never classifies by error text", () => {
    assert.equal(
      category(openFailure("codex", "spawn codex ENOENT: not found on PATH")),
      "unknown",
    );
    assert.equal(
      category(openFailure("codex", new Error("401 Unauthorized timed out"))),
      "unknown",
    );
  });
});

describe("providerStatusProperties", () => {
  it("sends only bounded fields, never messages, emails or instance names", () => {
    const properties = ProviderTelemetry.providerStatusProperties({
      ...missingClaude,
      installed: true,
      version: "2.1.302 (Claude Code)",
      status: "warning",
      auth: { status: "authenticated", email: "someone@example.com", label: "Max" },
    });

    assert.deepEqual(properties, {
      provider: missingClaude.driver,
      enabled: true,
      installed: true,
      version: "unparsed",
      status: "warning",
      authStatus: "authenticated",
    });
  });
});

it.effect("records each provider's state once, then again only when it changes", () =>
  Effect.gen(function* () {
    const changes = yield* Queue.unbounded<ReadonlyArray<ServerProvider>>();
    const recorded = yield* Queue.unbounded<Readonly<Record<string, unknown>>>();
    const installedClaude: ServerProvider = {
      ...missingClaude,
      installed: true,
      version: "2.1.302",
      status: "warning",
      auth: { status: "unauthenticated" },
    };

    yield* Effect.gen(function* () {
      const first = yield* Queue.take(recorded);
      // The unchanged snapshot from a refresh and a not-yet-checked placeholder
      // record nothing; the install does.
      yield* Queue.offer(changes, [missingClaude]);
      yield* Queue.offer(changes, [
        {
          ...missingClaude,
          status: "warning",
          message: "Claude provider status has not been checked in this session yet.",
          statusPending: true,
        },
      ]);
      yield* Queue.offer(changes, [installedClaude]);
      const second = yield* Queue.take(recorded);

      assert.deepEqual(first, {
        provider: "claudeAgent",
        enabled: true,
        installed: false,
        status: "error",
        authStatus: "unknown",
      });
      assert.deepEqual(second, {
        provider: "claudeAgent",
        enabled: true,
        installed: true,
        version: "2.1.302",
        status: "warning",
        authStatus: "unauthenticated",
      });
      assert.equal(yield* Queue.size(recorded), 0);
    }).pipe(
      Effect.provide(
        ProviderTelemetry.layerProviderStatusTelemetry.pipe(
          Layer.provide(
            Layer.succeed(ProviderRegistry.ProviderRegistry, {
              getProviders: Effect.succeed([missingClaude]),
              streamChanges: Stream.fromQueue(changes),
            } as unknown as ProviderRegistry.ProviderRegistry["Service"]),
          ),
          Layer.provide(
            Layer.succeed(
              AnalyticsService.AnalyticsService,
              AnalyticsService.AnalyticsService.of({
                record: (event, properties) =>
                  event === "provider.status.observed" && properties !== undefined
                    ? Queue.offer(recorded, properties).pipe(Effect.asVoid)
                    : Effect.void,
                recordMilestone: () => Effect.void,
                flush: Effect.void,
                enabled: true,
                sessionId: undefined,
                internalDevice: Effect.succeed(false),
                setInternalDevice: (enabled) => Effect.succeed(enabled),
              }),
            ),
          ),
        ),
      ),
    );
  }),
);

it.effect("reports a managed download as started, then finished with its outcome", () =>
  Effect.gen(function* () {
    const recorded: Array<[string, Readonly<Record<string, unknown>>]> = [];
    const state = (phase: ProviderInstallState["phase"]): ProviderInstallState => ({
      driver: ProviderDriverKind.make("codex"),
      operationId: null,
      phase,
      downloadedBytes: 0,
      totalBytes: null,
      version: null,
      installedVersion: null,
      canRemove: false,
      message: phase === "failed" ? "Download failed for /Users/someone/.upcomputer" : null,
    });

    yield* ProviderTelemetry.recordInstallTransitions(
      Stream.make(
        state("idle"),
        state("downloading"),
        state("downloading"),
        state("verifying"),
        state("succeeded"),
        state("downloading"),
        state("failed"),
      ),
      (event, properties) => Effect.sync(() => void recorded.push([event, properties])),
    );

    assert.deepEqual(
      recorded.map(([event, properties]) => [event, properties.outcome ?? null]),
      [
        ["provider.install.started", null],
        ["provider.install.finished", "succeeded"],
        ["provider.install.started", null],
        ["provider.install.finished", "failed"],
      ],
    );
    assert.isTrue(recorded.every(([, properties]) => !("message" in properties)));
  }),
);
