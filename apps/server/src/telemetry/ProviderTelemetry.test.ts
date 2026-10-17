import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderInstallState,
  type ServerProvider,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
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

describe("readinessErrorCategory", () => {
  it("classifies the provider failures a new user hits, from nested causes", () => {
    const wrapped = (cause: unknown) => ({ _tag: "ProviderSessionOpenError", cause: { cause } });
    assert.equal(
      ProviderTelemetry.readinessErrorCategory(
        wrapped(Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" })),
      ),
      "cli-missing",
    );
    assert.equal(
      ProviderTelemetry.readinessErrorCategory(wrapped(new Error("Not logged in"))),
      "auth",
    );
    assert.equal(ProviderTelemetry.readinessErrorCategory(wrapped("401 Unauthorized")), "auth");
    assert.equal(
      ProviderTelemetry.readinessErrorCategory(wrapped(new Error("Handshake timed out"))),
      "timeout",
    );
    assert.equal(ProviderTelemetry.readinessErrorCategory(wrapped(new Error("boom"))), "unknown");
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
      // The unchanged snapshot from a refresh records nothing; the install does.
      yield* Queue.offer(changes, [missingClaude]);
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
