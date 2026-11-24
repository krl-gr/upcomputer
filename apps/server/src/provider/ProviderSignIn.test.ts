import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  type TerminalEvent,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../config.ts";
import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
import * as ThreadViewers from "../orchestration-v2/ThreadViewers.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import * as AnalyticsService from "../telemetry/AnalyticsService.ts";
import { TerminalManager } from "../terminal/Manager.ts";
import { ProviderRegistry } from "./ProviderRegistry.ts";
import * as ProviderSignIn from "./ProviderSignIn.ts";

const threadId = ThreadId.make("thread-sign-in");

const provider = (
  driver: string,
  overrides: Partial<ServerProvider> = {},
  instanceId = driver,
): ServerProvider => ({
  instanceId: ProviderInstanceId.make(instanceId),
  driver: ProviderDriverKind.make(driver),
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "error",
  auth: { status: "unauthenticated" },
  checkedAt: "2026-11-24T00:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
  ...overrides,
});

interface Harness {
  readonly opened: Array<string>;
  readonly written: Array<string>;
  readonly refreshed: Array<string>;
  readonly listeners: Array<(event: TerminalEvent) => Effect.Effect<void>>;
  readonly recorded: Array<[string, unknown]>;
  pid: number;
}

const setup = (providers: ReadonlyArray<ServerProvider>) => {
  const harness: Harness = {
    opened: [],
    written: [],
    refreshed: [],
    listeners: [],
    recorded: [],
    pid: 100,
  };
  const layer = ProviderSignIn.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ProviderRegistry)({
          getProviders: Effect.succeed(providers),
          refreshInstance: (instanceId) =>
            Effect.sync(() => {
              harness.refreshed.push(instanceId);
              return providers;
            }),
        }),
        Layer.mock(ServerSettingsService)({ getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS) }),
        Layer.mock(AnalyticsService.AnalyticsService)({
          enabled: true,
          sessionId: undefined,
          record: (event, properties) =>
            Effect.sync(() => {
              harness.recorded.push([event, properties]);
            }),
        }),
        Layer.mock(ServerEnvironment)({
          getDescriptor: Effect.succeed({ platform: { os: "darwin" } } as never),
        }),
        ServerConfig.layerTest("/work", { prefix: "t3-provider-sign-in-" }).pipe(
          Layer.provide(NodeServices.layer),
        ),
        Layer.mock(TerminalManager)({
          open: (input) =>
            Effect.sync(() => {
              harness.opened.push(`${input.terminalId} ${input.providerInstanceId}`);
              return { pid: harness.pid } as never;
            }),
          write: (input) =>
            Effect.sync(() => {
              harness.written.push(input.data);
            }),
          subscribe: (listener) =>
            Effect.sync(() => {
              harness.listeners.push(listener);
              return () => {};
            }),
        }),
      ),
    ),
  );
  return { harness, layer };
};

/** Runs `effect` while a client follows the thread, unless `watched` is false. */
const withViewer = <A, E, R>(effect: Effect.Effect<A, E, R>, watched = true) => {
  const viewers = ThreadViewers.make();
  const provided = Effect.provideService(effect, ThreadViewers.ThreadViewers, viewers);
  if (!watched) return provided;
  return viewers
    .track(threadId, Stream.fromEffect(provided))
    .pipe(Stream.runHead, Effect.map(Option.getOrThrow));
};

/** The terminal manager's subprocess poll seeing the sign-in shell start or finish a command. */
const subprocess = (harness: Harness, running: boolean) =>
  Effect.forEach(harness.listeners, (listener) =>
    listener({
      type: "activity",
      threadId,
      terminalId: "provider-sign-in-claudeAgent",
      hasRunningSubprocess: running,
      label: running ? "claude" : "zsh",
    }),
  );

const signIn = (name: string) =>
  ProviderSignIn.ProviderSignIn.pipe(
    Effect.flatMap((service) => service.signIn({ threadId, provider: name })),
  );

describe("ProviderSignIn", () => {
  it.effect("types the sign-in command once per shell and reports the open terminal after", () => {
    const { harness, layer } = setup([provider("claudeAgent")]);
    return Effect.gen(function* () {
      const first = yield* withViewer(signIn("claude"));
      assert.strictEqual(first.status, "opened");
      assert.strictEqual(first.command, "claude auth login");
      assert.strictEqual(first.signInTerminalId, "provider-sign-in-claudeAgent");
      assert.deepStrictEqual(harness.opened, ["provider-sign-in-claudeAgent claudeAgent"]);
      // Typed without a newline: the user runs it.
      assert.deepStrictEqual(harness.written, ["claude auth login"]);

      const again = yield* withViewer(signIn("claudeAgent"));
      assert.strictEqual(again.status, "alreadyOpen");
      assert.isUndefined(again.signInTerminalId);
      assert.deepStrictEqual(harness.written, ["claude auth login"]);

      // The user pressed Enter: the login runs until they finish in the browser.
      yield* subprocess(harness, true);
      const running = yield* withViewer(signIn("claudeAgent"));
      assert.strictEqual(running.status, "alreadyOpen");
      assert.include(running.message, "in the browser");
      assert.deepStrictEqual(harness.written, ["claude auth login"]);

      // Cancelled or failed: the shell is back at an empty prompt, so it is typed again,
      // after Ctrl+U clears anything left on the line.
      yield* subprocess(harness, false);
      const retried = yield* withViewer(signIn("claudeAgent"));
      assert.strictEqual(retried.status, "opened");
      assert.deepStrictEqual(harness.written, ["claude auth login", "\u0015claude auth login"]);
      assert.strictEqual((yield* withViewer(signIn("claudeAgent"))).status, "alreadyOpen");

      harness.pid = 101;
      const restarted = yield* withViewer(signIn("claudeAgent"));
      assert.strictEqual(restarted.status, "opened");
      assert.strictEqual(harness.written.length, 3);
      assert.strictEqual(harness.refreshed.length, 6);
    }).pipe(Effect.provide(layer));
  });

  it.effect("opens nothing for a signed-in provider", () => {
    const { harness, layer } = setup([
      provider("codex", { status: "ready", auth: { status: "authenticated" } }),
    ]);
    return Effect.gen(function* () {
      const result = yield* withViewer(signIn("codex"));
      assert.strictEqual(result.status, "signedIn");
      assert.strictEqual(result.message, "Codex is signed in.");
      assert.deepStrictEqual(harness.opened, []);
    }).pipe(Effect.provide(layer));
  });

  it.effect("shows the app's own setup for app-managed providers, and installs nothing", () => {
    const { harness, layer } = setup([
      provider("antigravity", {
        installed: false,
        setup: { canAuthenticate: true, canInstall: true },
      }),
      provider("cursor", { setup: { canAuthenticate: true, canInstall: false } }),
      provider("pi"),
      provider(
        "antigravity",
        {
          enabled: false,
          status: "disabled",
          installed: false,
          setup: { canAuthenticate: true, canInstall: true },
        },
        "antigravity_off",
      ),
    ]);
    return Effect.gen(function* () {
      const antigravity = yield* withViewer(signIn("antigravity"));
      assert.strictEqual(antigravity.status, "appSetup");
      assert.strictEqual(antigravity.appSetupInstanceId, "antigravity");
      // The user starts the install from the card; the tool has no way to install.
      assert.include(antigravity.message, "Install button");
      // A new user's Antigravity is turned off; the card turns it on.
      const off = yield* withViewer(signIn("antigravity_off"));
      assert.strictEqual(off.status, "appSetup");
      assert.include(off.message, "Enable button");
      const cursor = yield* withViewer(signIn("cursor"));
      assert.strictEqual(cursor.status, "appSetup");
      assert.notInclude(cursor.message, "Install button");

      const pi = yield* withViewer(signIn("pi"));
      assert.strictEqual(pi.status, "useSettings");
      assert.include(pi.message, "Settings, Providers, Connect your agents");
      assert.strictEqual(
        (yield* Effect.flip(withViewer(signIn("cursor"), false))).reason,
        "no_window",
      );
      assert.deepStrictEqual(harness.opened, []);
      // Each call's outcome reaches product analytics, with the driver and never the name typed.
      assert.deepStrictEqual(harness.recorded, [
        ["onboarding.provider_sign_in", { outcome: "appSetup", provider: "antigravity" }],
        ["onboarding.provider_sign_in", { outcome: "appSetup", provider: "antigravity" }],
        ["onboarding.provider_sign_in", { outcome: "appSetup", provider: "cursor" }],
        ["onboarding.provider_sign_in", { outcome: "useSettings", provider: "pi" }],
        ["onboarding.provider_sign_in", { outcome: "failed", reason: "no_window" }],
      ]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("refuses when no window follows the thread, and names the command to run", () => {
    const { harness, layer } = setup([provider("grok")]);
    return Effect.gen(function* () {
      const error = yield* Effect.flip(withViewer(signIn("grok"), false));
      assert.strictEqual(error.reason, "no_window");
      assert.include(error.message, "`grok login`");
      assert.deepStrictEqual(harness.opened, []);
    }).pipe(Effect.provide(layer));
  });

  it.effect("refuses unknown, ambiguous, turned-off and missing providers", () => {
    const { harness, layer } = setup([
      provider("codex"),
      provider("codex", {}, "codex_work"),
      provider("kiro", { enabled: false, status: "disabled" }),
      provider("fx", { installed: false }),
    ]);
    return Effect.gen(function* () {
      for (const [name, reason] of [
        ["nope", "unknown_provider"],
        ["codex_", "unknown_provider"],
        ["kiro", "disabled"],
        ["fx", "not_installed"],
      ] as const) {
        const error = yield* Effect.flip(withViewer(signIn(name)));
        assert.strictEqual(error.reason, reason, name);
      }
      // An exact id wins over its prefix matching another instance.
      assert.strictEqual((yield* withViewer(signIn("codex"))).command, "codex login");
      assert.deepStrictEqual(harness.opened, ["provider-sign-in-codex codex"]);
    }).pipe(Effect.provide(layer));
  });
});
