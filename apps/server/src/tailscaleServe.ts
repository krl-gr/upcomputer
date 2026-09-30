/**
 * Tailscale Serve for this server (`--tailscale-serve`): configures it once
 * the HTTP server listens, keeps the outcome for clients to show, retries on
 * request, and undoes a successful setup on shutdown.
 *
 * @module TailscaleServe
 */
import type { ServerTailscaleServeStatus } from "@upcomputer/contracts";
import {
  disableTailscaleServe,
  ensureTailscaleServe,
  type TailscaleCommandExitError,
  type TailscaleServeError,
} from "@upcomputer/tailscale";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as ServerConfig from "./config.ts";

// Serve itself succeeds before any certificate exists; tailscaled provisions
// one on the first HTTPS request, and only when the tailnet allows it.
const TAILNET_DNS_HINT =
  "MagicDNS and HTTPS Certificates must be enabled on the DNS page of the Tailscale admin console.";

const outputExcerptOf = (excerpt: Redacted.Redacted<string> | undefined) =>
  excerpt === undefined ? {} : { outputExcerpt: Redacted.value(excerpt) };

function exitFailureMessage(error: TailscaleCommandExitError): string {
  switch (error.stderrDiagnostic) {
    case "not-logged-in":
      return "Tailscale is logged out. Log in to Tailscale, then retry.";
    case "permission-denied":
      return "Tailscale refused to change its Serve settings (permission denied).";
    default:
      return `tailscale serve failed with exit code ${error.exitCode}. ${TAILNET_DNS_HINT}`;
  }
}

/** What clients show for a failed `tailscale serve`. */
export function tailscaleServeStatusFromError(
  error: TailscaleServeError,
): ServerTailscaleServeStatus {
  switch (error._tag) {
    case "TailscaleServeApprovalRequiredError":
      return { status: "approval-required", approvalUrl: Redacted.value(error.approvalUrl) };
    case "TailscaleCommandSpawnError":
      return {
        status: "failed",
        message:
          "Up.computer can't run Tailscale's command-line tool. Install it from Tailscale's settings, then retry.",
      };
    case "TailscaleCommandOutputError":
      return {
        status: "failed",
        message: "Up.computer couldn't read the output of tailscale serve. Retry in a moment.",
      };
    case "TailscaleCommandTimeoutError":
      return {
        status: "failed",
        message: `tailscale serve didn't finish within ${Math.round(error.timeoutMs / 1_000)} seconds. ${TAILNET_DNS_HINT}`,
        ...outputExcerptOf(error.outputExcerpt),
      };
    case "TailscaleCommandExitError":
      return {
        status: "failed",
        message: exitFailureMessage(error),
        ...outputExcerptOf(error.outputExcerpt),
      };
  }
}

export class TailscaleServe extends Context.Service<
  TailscaleServe,
  {
    readonly status: Effect.Effect<ServerTailscaleServeStatus>;
    /** Serves `localPort` over Tailscale HTTPS when the config asks for it. */
    readonly configure: (localPort: number) => Effect.Effect<ServerTailscaleServeStatus>;
    /** Runs `configure` again for the last port; a no-op before the first run. */
    readonly retry: Effect.Effect<ServerTailscaleServeStatus>;
    /** Removes the mapping if this server set it up. */
    readonly disable: Effect.Effect<void>;
  }
>()("@upcomputer/server/tailscaleServe") {}

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const servePort = config.tailscaleServePort;
  const statusRef = yield* Ref.make<ServerTailscaleServeStatus>({
    status: config.tailscaleServeEnabled ? "pending" : "disabled",
  });
  const localPortRef = yield* Ref.make<number | null>(null);
  const configuredRef = yield* Ref.make(false);
  const lock = yield* Semaphore.make(1);

  const configure = (localPort: number) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        yield* Ref.set(localPortRef, localPort);
        if (!config.tailscaleServeEnabled) {
          return yield* Ref.get(statusRef);
        }
        yield* Ref.set(statusRef, { status: "pending" });
        const status = yield* ensureTailscaleServe({
          localPort,
          servePort,
          localHost: "127.0.0.1",
        }).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Effect.tap(() => Ref.set(configuredRef, true)),
          Effect.tap(() => Effect.logInfo("Tailscale Serve configured", { localPort, servePort })),
          Effect.as<ServerTailscaleServeStatus>({ status: "configured" }),
          Effect.catch((cause) =>
            Effect.logWarning("Failed to configure Tailscale Serve", {
              cause,
              localPort,
              servePort,
            }).pipe(Effect.as(tailscaleServeStatusFromError(cause))),
          ),
        );
        yield* Ref.set(statusRef, status);
        return status;
      }),
    );

  const retry = Ref.get(localPortRef).pipe(
    Effect.flatMap((localPort) => (localPort === null ? Ref.get(statusRef) : configure(localPort))),
  );

  const disable = lock.withPermits(1)(
    Effect.gen(function* () {
      if (!(yield* Ref.get(configuredRef))) {
        return;
      }
      yield* disableTailscaleServe({ servePort }).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.tap(() => Effect.logInfo("Tailscale Serve disabled", { servePort })),
        Effect.catch((cause) =>
          Effect.logWarning("Failed to disable Tailscale Serve", { cause, servePort }),
        ),
      );
      yield* Ref.set(configuredRef, false);
    }),
  );

  return TailscaleServe.of({
    status: Ref.get(statusRef),
    configure,
    retry,
    disable,
  });
});

export const layer = Layer.effect(TailscaleServe, make);
