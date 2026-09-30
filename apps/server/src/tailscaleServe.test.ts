import { assert, describe, it } from "@effect/vitest";
import {
  TailscaleCommandExitError,
  TailscaleCommandSpawnError,
  TailscaleCommandTimeoutError,
  TailscaleServeApprovalRequiredError,
} from "@upcomputer/tailscale";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as ServerConfig from "./config.ts";
import * as TailscaleServe from "./tailscaleServe.ts";

const encoder = new TextEncoder();
const APPROVAL_URL = "https://login.tailscale.com/f/serve?node=nTest";
const serveContext = {
  executable: "tailscale",
  subcommand: "serve",
  argumentCount: 4,
} as const;

/** Answers each spawn with the next scripted result and records the args. */
function scriptedSpawnerLayer(results: ReadonlyArray<{ stdout?: string; code?: number }>) {
  const calls: Array<ReadonlyArray<string>> = [];
  const layer = Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) => {
      const { args } = command as unknown as { readonly args: ReadonlyArray<string> };
      const result = results[calls.length] ?? {};
      calls.push(args);
      return Effect.succeed(
        ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(1),
          exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(result.code ?? 0)),
          isRunning: Effect.succeed(false),
          kill: () => Effect.void,
          unref: Effect.succeed(Effect.void),
          stdin: Sink.drain,
          stdout: Stream.make(encoder.encode(result.stdout ?? "")),
          stderr: Stream.empty,
          all: Stream.empty,
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
        }),
      );
    }),
  );
  return { layer, calls };
}

const serviceLayer = (input: {
  readonly enabled: boolean;
  readonly spawner: Layer.Layer<ChildProcessSpawner.ChildProcessSpawner>;
}) =>
  TailscaleServe.layer.pipe(
    Layer.provide(
      // The service reads only these two fields.
      Layer.succeed(ServerConfig.ServerConfig, {
        tailscaleServeEnabled: input.enabled,
        tailscaleServePort: 443,
      } as ServerConfig.ServerConfig["Service"]),
    ),
    Layer.provide(input.spawner),
  );

describe("tailscaleServeStatusFromError", () => {
  it("surfaces the approval link", () => {
    assert.deepEqual(
      TailscaleServe.tailscaleServeStatusFromError(
        new TailscaleServeApprovalRequiredError({
          ...serveContext,
          approvalUrl: Redacted.make(APPROVAL_URL),
        }),
      ),
      { status: "approval-required", approvalUrl: APPROVAL_URL },
    );
  });

  it("explains failures with the output excerpt and the tailnet DNS requirements", () => {
    const exit = TailscaleServe.tailscaleServeStatusFromError(
      new TailscaleCommandExitError({
        ...serveContext,
        exitCode: 1,
        stderrLength: 20,
        stderrDiagnostic: "unknown",
        outputExcerpt: Redacted.make("error: certificate unavailable"),
      }),
    );
    assert.deepEqual(exit, {
      status: "failed",
      message:
        "tailscale serve failed with exit code 1. MagicDNS and HTTPS Certificates must be enabled on the DNS page of the Tailscale admin console.",
      outputExcerpt: "error: certificate unavailable",
    });

    const timeout = TailscaleServe.tailscaleServeStatusFromError(
      new TailscaleCommandTimeoutError({ ...serveContext, timeoutMs: 10_000, cause: null }),
    );
    assert.equal(timeout.status, "failed");
    assert.isTrue(
      timeout.status === "failed" && timeout.message.startsWith("tailscale serve didn't finish"),
    );
    assert.notProperty(timeout, "outputExcerpt");

    const loggedOut = TailscaleServe.tailscaleServeStatusFromError(
      new TailscaleCommandExitError({
        ...serveContext,
        exitCode: 1,
        stderrLength: 10,
        stderrDiagnostic: "not-logged-in",
      }),
    );
    assert.deepEqual(loggedOut, {
      status: "failed",
      message: "Tailscale is logged out. Log in to Tailscale, then retry.",
    });

    const missing = TailscaleServe.tailscaleServeStatusFromError(
      new TailscaleCommandSpawnError({ ...serveContext, cause: null }),
    );
    assert.equal(missing.status, "failed");
  });
});

describe("TailscaleServe", () => {
  it.effect("keeps an approval request as its status and configures on retry", () => {
    const spawner = scriptedSpawnerLayer([
      { stdout: `To enable, visit:\n\n         ${APPROVAL_URL}\n` },
      {},
      {},
    ]);

    return Effect.gen(function* () {
      const tailscaleServe = yield* TailscaleServe.TailscaleServe;
      assert.deepEqual(yield* tailscaleServe.status, { status: "pending" });

      yield* tailscaleServe.configure(13773);
      assert.deepEqual(yield* tailscaleServe.status, {
        status: "approval-required",
        approvalUrl: APPROVAL_URL,
      });

      assert.deepEqual(yield* tailscaleServe.retry, { status: "configured" });
      yield* tailscaleServe.disable;

      assert.deepEqual(spawner.calls, [
        ["serve", "--bg", "--https=443", "http://127.0.0.1:13773"],
        ["serve", "--bg", "--https=443", "http://127.0.0.1:13773"],
        ["serve", "--https=443", "off"],
      ]);
    }).pipe(Effect.provide(serviceLayer({ enabled: true, spawner: spawner.layer })));
  });

  it.effect("does not undo a mapping it never set up", () => {
    const spawner = scriptedSpawnerLayer([{ code: 1 }]);

    return Effect.gen(function* () {
      const tailscaleServe = yield* TailscaleServe.TailscaleServe;
      const status = yield* tailscaleServe.configure(13773);
      assert.equal(status.status, "failed");
      yield* tailscaleServe.disable;
      assert.equal(spawner.calls.length, 1);
    }).pipe(Effect.provide(serviceLayer({ enabled: true, spawner: spawner.layer })));
  });

  it.effect("stays disabled without running tailscale when serve is off", () => {
    const spawner = scriptedSpawnerLayer([]);

    return Effect.gen(function* () {
      const tailscaleServe = yield* TailscaleServe.TailscaleServe;
      assert.deepEqual(yield* tailscaleServe.configure(13773), { status: "disabled" });
      assert.deepEqual(yield* tailscaleServe.retry, { status: "disabled" });
      yield* tailscaleServe.disable;
      assert.equal(spawner.calls.length, 0);
    }).pipe(Effect.provide(serviceLayer({ enabled: false, spawner: spawner.layer })));
  });
});
