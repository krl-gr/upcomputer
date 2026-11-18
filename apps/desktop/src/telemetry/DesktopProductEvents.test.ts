import {
  DesktopHostTelemetryMessage,
  type DesktopProductEvent,
  type DesktopSessionStateEntry,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as DesktopProductEvents from "./DesktopProductEvents.ts";
import * as DesktopSessionState from "./DesktopSessionState.ts";

const decodeLine = Schema.decodeUnknownSync(Schema.fromJsonString(DesktopHostTelemetryMessage));

const takeEvents = (service: DesktopProductEvents.DesktopProductEvents["Service"], count: number) =>
  service.encoded.pipe(
    Stream.take(count),
    Stream.map((bytes) => decodeLine(new TextDecoder().decode(bytes).trimEnd())),
    Stream.runCollect,
  );

const rendererGone = {
  event: "desktop.renderer.gone",
  reason: "crashed",
  surface: "main",
  exitCode: 11,
} satisfies DesktopProductEvent;

function errorFrom(fn: string) {
  const error = new TypeError("secret window title");
  error.stack = `TypeError: secret window title\n    at ${fn} (/Applications/Up.computer.app/Contents/Resources/app.asar/main.cjs:1:2)`;
  return error;
}

describe("backendExitSignal", () => {
  it("reads the signal from Effect's exit status error, and nothing else", () => {
    const killed = PlatformError.systemError({
      _tag: "Unknown",
      module: "ChildProcess",
      method: "exitCode",
      cause: new Error("Process interrupted due to receipt of signal: 'SIGSEGV'"),
    });
    assert.equal(DesktopProductEvents.backendExitSignal({ cause: killed }), "SIGSEGV");
    assert.equal(
      DesktopProductEvents.backendExitSignal(
        new Error("Process interrupted due to receipt of signal: 'SIGWINCH'"),
      ),
      "other",
    );
    assert.isNull(DesktopProductEvents.backendExitSignal(new Error("spawn failed")));
    assert.isNull(DesktopProductEvents.backendExitSignal(undefined));
  });
});

it.layer(DesktopProductEvents.layer)("DesktopProductEvents", (it) => {
  it.effect("sends main process throws and rejections as app.error, without text", () =>
    Effect.gen(function* () {
      const service = yield* DesktopProductEvents.DesktopProductEvents;
      // The service's listeners are the latest; the test runner has its own.
      process.listeners("uncaughtExceptionMonitor").at(-1)?.(
        errorFrom("createWindow"),
        "uncaughtException",
      );
      // Electron's main process only warns about rejections; the listener reports them.
      process.listeners("unhandledRejection").at(-1)?.(
        errorFrom("loadSettings"),
        Promise.resolve(),
      );

      const messages = yield* takeEvents(service, 2);
      const events = messages.map((message) =>
        message.type === "desktopProductEvent" ? message.event : undefined,
      );
      assert.deepEqual(
        events.map((event) =>
          event?.event === "app.error" ? [event.kind, event.errorClass, event.module] : event,
        ),
        [
          ["uncaught", "TypeError", "main.cjs"],
          ["unhandled_rejection", "TypeError", "main.cjs"],
        ],
      );
      assert.notInclude(JSON.stringify(events), "secret");
    }),
  );

  it.effect("sends one error per stack and caps each event type", () =>
    Effect.gen(function* () {
      const service = yield* DesktopProductEvents.DesktopProductEvents;
      const error = {
        event: "app.error",
        kind: "uncaught",
        errorClass: "Error",
        stackHash: "00000000000000ff",
      } satisfies DesktopProductEvent;
      yield* service.record(error);
      yield* service.record(error);
      for (let index = 0; index < 30; index++) yield* service.record(rendererGone);

      const messages = yield* takeEvents(service, 21);
      const names = messages.map((message) =>
        message.type === "desktopProductEvent" ? message.event.event : message.type,
      );
      assert.deepEqual(names.slice(0, 1), ["app.error"]);
      assert.equal(names.filter((name) => name === "desktop.renderer.gone").length, 20);
    }),
  );
});

describe("DesktopProductEvents session state", () => {
  it.effect("keeps why the primary backend or the main window went away for the next start", () => {
    const states: Array<DesktopSessionStateEntry> = [];
    const backendExited = (instance: "primary" | "other", code: number | null) =>
      ({
        event: "desktop.backend.exited",
        instance,
        code,
        signal: code === null ? "SIGKILL" : null,
        uptimeMs: 1,
        wasReady: true,
        restarted: true,
      }) satisfies DesktopProductEvent;
    return Effect.gen(function* () {
      const service = yield* DesktopProductEvents.DesktopProductEvents;
      yield* service.record(backendExited("primary", 1));
      yield* service.record(backendExited("other", 2));
      yield* service.record(backendExited("primary", null));
      yield* service.record(rendererGone);
      yield* service.record({ ...rendererGone, surface: "preview" });
      yield* service.record({ ...rendererGone, reason: "clean-exit" });

      assert.deepEqual(states, [
        { state: "backend_exited", code: 1, signal: null },
        { state: "backend_exited", code: null, signal: "SIGKILL" },
        { state: "renderer_gone", reason: "crashed", exitCode: 11 },
      ]);
    }).pipe(
      Effect.provide(
        DesktopProductEvents.layer.pipe(
          Layer.provide(
            Layer.succeed(DesktopSessionState.DesktopSessionState, {
              sessionId: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d",
              recordUnsafe: (last) => {
                states.push(last);
              },
            }),
          ),
        ),
      ),
    );
  });
});
