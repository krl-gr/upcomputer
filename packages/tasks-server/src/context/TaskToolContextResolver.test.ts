import { assert, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderState,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  ProjectStoreV2,
  ProviderRegistry,
  ServerSettingsService,
  ThreadManagementService,
} from "../../../../apps/server/src/extensionApi.ts";
import {
  compactTaskToolContext,
  TaskToolContextResolver,
  TaskToolContextResolverLive,
} from "./TaskToolContextResolver.ts";

const provider = (input: {
  readonly driver: string;
  readonly models: ReadonlyArray<string>;
  readonly enabled?: boolean;
  readonly installed?: boolean;
  readonly status?: ServerProviderState;
  readonly auth?: ServerProvider["auth"]["status"];
  readonly message?: string;
}): ServerProvider => ({
  instanceId: ProviderInstanceId.make(input.driver),
  driver: ProviderDriverKind.make(input.driver),
  enabled: input.enabled ?? true,
  installed: input.installed ?? true,
  version: input.installed === false ? null : "1.0.0",
  status: input.status ?? "ready",
  auth: { status: input.auth ?? "authenticated" },
  checkedAt: "2026-10-22T00:00:00.000Z",
  ...(input.message === undefined ? {} : { message: input.message }),
  models: input.models.map((slug) => ({ slug, name: slug, isCustom: false, capabilities: null })),
  slashCommands: [],
  skills: [],
});

const openCodeReady = provider({ driver: "opencode", models: ["opencode/glm-5.3-flash-free"] });
const claudeMissing = provider({
  driver: "claudeAgent",
  models: ["claude-opus-5-5", "claude-sonnet-5-5"],
  installed: false,
  status: "error",
  auth: "unknown",
  message: "Claude Agent CLI (`claude`) was not found on PATH.",
});
const claudeReady = provider({
  driver: "claudeAgent",
  models: ["claude-opus-5-5", "claude-sonnet-5-5"],
});

const resolveWith = (getProviders: Effect.Effect<ReadonlyArray<ServerProvider>>) =>
  Effect.gen(function* () {
    const resolver = yield* TaskToolContextResolver;
    return (modelAlias?: string) =>
      resolver.resolve({
        args: modelAlias === undefined ? {} : { modelAlias },
        invocationContext: { source: "mcp", mutationPolicy: "allow" },
      });
  }).pipe(
    Effect.provide(
      TaskToolContextResolverLive.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(ProjectStoreV2)({ listShells: () => Effect.succeed([]) }),
            Layer.mock(ThreadManagementService)({}),
            Layer.mock(ProviderRegistry)({ getProviders }),
            ServerSettingsService.layerTest(),
          ),
        ),
      ),
    ),
  );

const listed = (providers: ReadonlyArray<{ readonly instanceId: string }>) =>
  providers.map((entry) => entry.instanceId);

it.effect("lists only OpenCode when it is the only ready provider", () =>
  Effect.gen(function* () {
    const codexMissing = provider({
      driver: "codex",
      models: ["gpt-6-astra"],
      installed: false,
      status: "error",
      auth: "unknown",
    });
    const resolve = yield* resolveWith(
      Effect.succeed([claudeMissing, codexMissing, openCodeReady]),
    );
    const resolution = yield* resolve();

    assert.deepEqual(listed(resolution.providers), ["opencode"]);
    assert.deepEqual(resolution.providersNotSetUp, [
      {
        instanceId: "claudeAgent",
        driver: "claudeAgent",
        displayName: null,
        reason: "Claude Agent CLI (`claude`) was not found on PATH.",
      },
      { instanceId: "codex", driver: "codex", displayName: null, reason: "Not installed." },
    ]);
    const forAgents = JSON.stringify(compactTaskToolContext(resolution, ["providers"]));
    assert.notInclude(forAgents, "claude-opus-5-5");
    assert.notInclude(forAgents, "gpt-6-astra");

    const opus = yield* resolve("claude-opus-5-5");
    assert.isNull(opus.resolvedModel);
    assert.include(opus.errors.join(" "), "did not match an available provider/model");
  }),
);

it.effect("leaves out a provider that is installed but not signed in", () =>
  Effect.gen(function* () {
    const codexSignedOut = provider({
      driver: "codex",
      models: ["gpt-6-astra"],
      status: "error",
      auth: "unauthenticated",
    });
    const resolve = yield* resolveWith(Effect.succeed([codexSignedOut, openCodeReady]));
    const resolution = yield* resolve();

    assert.deepEqual(listed(resolution.providers), ["opencode"]);
    assert.deepEqual(
      resolution.providersNotSetUp.map(({ instanceId, reason }) => ({ instanceId, reason })),
      [{ instanceId: "codex", reason: "Not signed in." }],
    );
  }),
);

it.effect("leaves out a disabled provider even when its last check was ready", () =>
  Effect.gen(function* () {
    const claudeDisabled = { ...claudeReady, enabled: false };
    const resolve = yield* resolveWith(Effect.succeed([claudeDisabled, openCodeReady]));
    const resolution = yield* resolve();

    assert.deepEqual(listed(resolution.providers), ["opencode"]);
    assert.deepEqual(
      resolution.providersNotSetUp.map(({ instanceId, reason }) => ({ instanceId, reason })),
      [{ instanceId: "claudeAgent", reason: "Disabled in settings." }],
    );
  }),
);

it.effect("lists a provider once it becomes ready later in the session", () =>
  Effect.gen(function* () {
    let providers: ReadonlyArray<ServerProvider> = [
      { ...claudeReady, installed: false, status: "warning", auth: { status: "unknown" } },
      openCodeReady,
    ];
    const resolve = yield* resolveWith(Effect.sync(() => providers));

    assert.deepEqual(listed((yield* resolve()).providers), ["opencode"]);

    providers = [claudeReady, openCodeReady];
    const later = yield* resolve();
    assert.deepEqual(listed(later.providers), ["claudeAgent", "opencode"]);
    assert.deepEqual(later.providersNotSetUp, []);
    assert.deepEqual((yield* resolve("claude-opus-5-5")).resolvedModel?.modelSelection, {
      instanceId: ProviderInstanceId.make("claudeAgent"),
      model: "claude-opus-5-5",
    });
  }),
);
