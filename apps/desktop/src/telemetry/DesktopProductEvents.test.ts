import { DesktopHostTelemetryMessage, type DesktopProductEvent } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as DesktopProductEvents from "./DesktopProductEvents.ts";

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
