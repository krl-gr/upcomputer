import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as SynchronizedRef from "effect/SynchronizedRef";

import * as FileSystem from "effect/FileSystem";
import { HttpClient } from "effect/http";
import { ChildProcessSpawner } from "effect/process";

import * as DesktopBackendConfiguration from "./DesktopBackendConfiguration.ts";
import * as DesktopBackendManager from "./DesktopBackendManager.ts";
import * as DesktopOrphanedBackend from "./DesktopOrphanedBackend.ts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopObservability from "../app/DesktopObservability.ts";
import * as DesktopAppSettings from "../settings/DesktopAppSettings.ts";
import * as DesktopTelemetryPublisher from "../telemetry/DesktopTelemetryPublisher.ts";
import * as DesktopBrowserHost from "../preview/DesktopBrowserHost.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";
import * as DesktopWslEnvironment from "../wsl/DesktopWslEnvironment.ts";
import * as ElectronDialog from "../electron/ElectronDialog.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";

const { logWarning: logBackendPoolWarning } =
  DesktopObservability.makeComponentLogger("desktop-backend-pool");

export type BackendInstanceId = DesktopBackendManager.BackendInstanceId;
export const BackendInstanceId = DesktopBackendManager.BackendInstanceId;
export const PRIMARY_INSTANCE_ID = DesktopBackendManager.PRIMARY_INSTANCE_ID;
export type DesktopBackendInstance = DesktopBackendManager.DesktopBackendInstance;
export type BackendInstanceSpec = DesktopBackendManager.BackendInstanceSpec;

export class DesktopBackendPoolInstanceAlreadyRegisteredError extends Schema.TaggedError<DesktopBackendPoolInstanceAlreadyRegisteredError>()(
  "DesktopBackendPoolInstanceAlreadyRegisteredError",
  {
    id: Schema.String,
  },
) {
  override get message() {
    return `Backend instance "${this.id}" is already registered in the pool.`;
  }
}

export class DesktopBackendPoolCannotUnregisterPrimaryError extends Schema.TaggedError<DesktopBackendPoolCannotUnregisterPrimaryError>()(
  "DesktopBackendPoolCannotUnregisterPrimaryError",
  {},
) {
  override get message() {
    return "Refusing to unregister the primary backend from the pool.";
  }
}

export class DesktopBackendPool extends Context.Service<
  DesktopBackendPool,
  {
    readonly get: (id: BackendInstanceId) => Effect.Effect<Option.Option<DesktopBackendInstance>>;
    readonly list: Effect.Effect<readonly DesktopBackendInstance[]>;
    readonly primary: Effect.Effect<DesktopBackendInstance>;
    readonly register: (
      spec: BackendInstanceSpec,
    ) => Effect.Effect<DesktopBackendInstance, DesktopBackendPoolInstanceAlreadyRegisteredError>;
    readonly unregister: (
      id: BackendInstanceId,
    ) => Effect.Effect<void, DesktopBackendPoolCannotUnregisterPrimaryError>;
  }
>()("@t3tools/desktop/backend/DesktopBackendPool") {}

export type BackendInstanceFactoryRequirements =
  | FileSystem.FileSystem
  | ChildProcessSpawner.ChildProcessSpawner
  | HttpClient.HttpClient
  | DesktopObservability.DesktopBackendOutputLogFactory
  | DesktopTelemetryPublisher.DesktopTelemetryPublisher
  | DesktopBrowserHost.DesktopBrowserHost
  | DesktopWslEnvironment.DesktopWslEnvironment;

interface ActiveRegisteredInstance {
  readonly _tag: "Active";
  readonly instance: DesktopBackendInstance;
  readonly scope: Option.Option<Scope.Closeable>;
}

interface ClosingRegisteredInstance {
  readonly _tag: "Closing";
  readonly done: Deferred.Deferred<void>;
}

type RegisteredInstance = ActiveRegisteredInstance | ClosingRegisteredInstance;

type RegisterAction =
  | { readonly _tag: "Registered"; readonly instance: DesktopBackendInstance }
  | { readonly _tag: "Wait"; readonly done: Deferred.Deferred<void> };

type UnregisterAction =
  | { readonly _tag: "Absent" }
  | { readonly _tag: "Wait"; readonly done: Deferred.Deferred<void> }
  | { readonly _tag: "Close"; readonly entry: ActiveRegisteredInstance };

export const layer = Layer.effect(
  DesktopBackendPool,
  Effect.gen(function* () {
    const configuration = yield* DesktopBackendConfiguration.DesktopBackendConfiguration;
    const desktopWindow = yield* DesktopWindow.DesktopWindow;
    const electronDialog = yield* ElectronDialog.ElectronDialog;
    const electronApp = yield* ElectronApp.ElectronApp;
    const appSettings = yield* DesktopAppSettings.DesktopAppSettings;
    // Without this, instance scopes are orphaned: they only close via explicit unregister() calls,
    // so on app shutdown the WSL backend child process gets hard-killed by the OS instead of
    // receiving the graceful SIGTERM + grace period the instance's stop finalizer would otherwise
    // run.
    const layerScope = yield* Scope.Scope;
    const factoryContext = yield* Effect.context<BackendInstanceFactoryRequirements>();

    // Fatal configuration failures persist the Windows fallback. Bounded
    // transport failures use an in-memory fallback for this launch so the app
    // opens without overwriting the user's WSL preference.
    const handlePrimaryPreflightFailure = Effect.fn("desktop.backendPool.primaryPreflightFailed")(
      function* (failure: DesktopBackendManager.PreflightFailure) {
        const { reason, fatal } = failure;
        if (!fatal) {
          yield* logBackendPoolWarning(
            "primary WSL preflight retry window exhausted; using Windows for this launch",
            { reason },
          );
          yield* electronDialog.showErrorBox(
            "WSL isn't available",
            `Up.computer couldn't start in WSL (${reason}), so it's running on Windows for this launch. It tries WSL again the next time the app starts.`,
          );
          yield* appSettings.applyWslWindowsFallbackInMemory;
          return true;
        }

        yield* logBackendPoolWarning("primary WSL preflight failed; falling back to Windows", {
          reason,
        });
        yield* electronDialog.showErrorBox(
          "WSL isn't available",
          `Up.computer couldn't start in WSL (${reason}), so it's running on Windows for now. Fix WSL, then turn it back on in Settings > Connections.`,
        );
        // Clearing wslBackendEnabled alone would leave a stale wslOnly:true that silently re-traps
        // the user in wsl-only mode the next time they enable WSL. If the persisted write fails,
        // keep this process recoverable by applying the fallback to in-memory settings.
        yield* appSettings.applyWslWindowsFallback.pipe(
          Effect.catch((error) =>
            logBackendPoolWarning(
              "failed to persist Windows fallback after WSL preflight failure",
              {
                error: error.message,
              },
            ).pipe(Effect.andThen(appSettings.applyWslWindowsFallbackInMemory)),
          ),
        );
        return true;
      },
    );

    // A forced quit can leave this app's own server running, holding the data
    // folder. Offer to stop exactly that process; anything else (the background
    // service, another copy) only gets an explanation.
    const handlePrimaryStateDirOwned = Effect.gen(function* () {
      const environment = yield* Effect.serviceOption(DesktopEnvironment.DesktopEnvironment);
      const orphanPid = Option.isNone(environment)
        ? null
        : yield* DesktopOrphanedBackend.findOrphanedBackend(
            environment.value.stateDir,
            process.execPath,
          );
      if (orphanPid === null) {
        yield* electronDialog.showErrorBox(
          "Up.computer is already running",
          "Another copy of Up.computer is using your data on this computer. Quit it, then open Up.computer again.",
        );
        return yield* electronApp.quit;
      }
      const { response } = yield* electronDialog
        .showMessageBox({
          type: "warning",
          title: "Up.computer is still running in the background",
          message: "Up.computer is still running in the background",
          detail:
            "A previous Up.computer session did not shut down and is still using your data. Choose Quit it and reopen to stop it and start normally.",
          buttons: ["Quit it and reopen", "Quit"],
          defaultId: 0,
          cancelId: 1,
        })
        .pipe(Effect.orElseSucceed(() => ({ response: 1, checkboxChecked: false })));
      if (response !== 0) return yield* electronApp.quit;
      const stopped = yield* DesktopOrphanedBackend.stopOrphanedBackend(orphanPid);
      if (!stopped) {
        yield* logBackendPoolWarning("leftover backend did not stop", { pid: orphanPid });
        yield* electronDialog.showErrorBox(
          "Up.computer couldn't stop the previous session",
          `The previous session (process ${orphanPid}) is still running. Restart your computer, then open Up.computer again.`,
        );
        return yield* electronApp.quit;
      }
      yield* electronApp.relaunch({});
      yield* electronApp.exit(0);
    });

    // While the server is down the window can't show anything, so a crash loop
    // is reported natively, once per loop.
    const handlePrimaryRestartLoop = (input: {
      readonly attempts: number;
      readonly reason: string;
    }) =>
      Effect.gen(function* () {
        const environment = yield* Effect.serviceOption(DesktopEnvironment.DesktopEnvironment);
        const shell = yield* Effect.serviceOption(ElectronShell.ElectronShell);
        const logDir = Option.isSome(environment) ? environment.value.logDir : null;
        const diagnostics = [
          `Up.computer ${yield* HostProcess.Platform} ${yield* HostProcess.Architecture}`,
          `Restarts: ${input.attempts}`,
          `Last exit: ${input.reason}`,
          ...(logDir === null ? [] : [`Logs: ${logDir}`]),
        ].join("\n");
        const { response } = yield* electronDialog
          .showMessageBox({
            type: "error",
            title: "Up.computer stopped working",
            message: "Up.computer stopped working",
            detail: `The part of Up.computer that runs your agents stopped (${input.reason}) and is restarting. If this keeps happening, restart the app or contact us with the diagnostics.`,
            buttons: ["Restart Up.computer", "Copy diagnostics", "Keep waiting"],
            defaultId: 0,
            cancelId: 2,
          })
          .pipe(Effect.orElseSucceed(() => ({ response: 2, checkboxChecked: false })));
        if (response === 0) {
          yield* electronApp.relaunch({});
          yield* electronApp.exit(0);
        } else if (response === 1 && Option.isSome(shell)) {
          yield* shell.value.copyText(diagnostics);
        }
      });

    const primary = yield* DesktopBackendManager.makeBackendInstance({
      id: DesktopBackendManager.PRIMARY_INSTANCE_ID,
      // Keep this lazy. The pool layer is initialized before startup loads
      // persisted desktop settings, so resolving the primary label here would
      // permanently capture DEFAULT_DESKTOP_SETTINGS and mislabel WSL-only
      // primaries as Windows.
      label: configuration.resolvePrimaryLabel,
      configResolve: configuration.resolvePrimary,
      // Window creation errors propagating out of handleBackendReady must not block the readiness
      // callback (that would prevent restartAttempt from being reset), so we absorb them here.
      onReady: (httpBaseUrl) =>
        desktopWindow.handleBackendReady(httpBaseUrl).pipe(
          Effect.catch((error) =>
            logBackendPoolWarning("failed to open main window after backend readiness", {
              error: error.message,
            }).pipe(
              // Without a window the app looks like it never opened.
              Effect.andThen(
                electronDialog.showErrorBox(
                  "Up.computer couldn't open its window",
                  "Up.computer started but couldn't open its window. Quit and open it again, and contact us if this keeps happening.",
                ),
              ),
            ),
          ),
        ),
      onShutdown: () => desktopWindow.handleBackendNotReady,
      onPreflightFailed: handlePrimaryPreflightFailure,
      onStateDirOwned: () => handlePrimaryStateDirOwned,
      onRestartLoop: handlePrimaryRestartLoop,
    });

    const instancesRef = yield* SynchronizedRef.make<
      ReadonlyMap<BackendInstanceId, RegisteredInstance>
    >(
      new Map([
        [
          DesktopBackendManager.PRIMARY_INSTANCE_ID,
          { _tag: "Active", instance: primary, scope: Option.none() },
        ],
      ]),
    );

    const register: DesktopBackendPool["Service"]["register"] = (spec) =>
      Effect.suspend(() =>
        SynchronizedRef.modifyEffect(
          instancesRef,
          (
            current,
          ): Effect.Effect<
            readonly [RegisterAction, ReadonlyMap<BackendInstanceId, RegisteredInstance>],
            DesktopBackendPoolInstanceAlreadyRegisteredError
          > => {
            const existing = current.get(spec.id);
            if (existing?._tag === "Active") {
              return Effect.fail(
                new DesktopBackendPoolInstanceAlreadyRegisteredError({ id: spec.id }),
              );
            }
            if (existing?._tag === "Closing") {
              return Effect.succeed([
                { _tag: "Wait", done: existing.done } as const,
                current,
              ] as const);
            }
            return Effect.gen(function* () {
              // Provide the captured factory services first, then the child scope
              // last so instance finalizers are owned by the unregisterable scope.
              const instanceScope = yield* Scope.fork(layerScope, "sequential");
              const instance = yield* DesktopBackendManager.makeBackendInstance(spec).pipe(
                Effect.provide(factoryContext),
                Scope.provide(instanceScope),
              );
              const next = new Map(current);
              next.set(spec.id, {
                _tag: "Active",
                instance,
                scope: Option.some(instanceScope),
              });
              return [
                { _tag: "Registered", instance } as const,
                next as ReadonlyMap<BackendInstanceId, RegisteredInstance>,
              ] as const;
            });
          },
        ).pipe(
          Effect.flatMap((result) =>
            result._tag === "Registered"
              ? Effect.succeed(result.instance)
              : Deferred.await(result.done).pipe(Effect.andThen(register(spec))),
          ),
        ),
      );

    const unregister: DesktopBackendPool["Service"]["unregister"] = (id) =>
      Effect.gen(function* () {
        if (id === DesktopBackendManager.PRIMARY_INSTANCE_ID) {
          return yield* new DesktopBackendPoolCannotUnregisterPrimaryError();
        }
        const done = yield* Deferred.make<void>();
        const action = yield* SynchronizedRef.modifyEffect(
          instancesRef,
          (
            current,
          ): Effect.Effect<
            readonly [UnregisterAction, ReadonlyMap<BackendInstanceId, RegisteredInstance>]
          > => {
            const entry = current.get(id);
            if (entry === undefined) {
              return Effect.succeed([{ _tag: "Absent" } as const, current] as const);
            }
            if (entry._tag === "Closing") {
              return Effect.succeed([
                { _tag: "Wait", done: entry.done } as const,
                current,
              ] as const);
            }
            const next = new Map(current);
            next.set(id, { _tag: "Closing", done });
            return Effect.succeed([
              { _tag: "Close", entry } as const,
              next as ReadonlyMap<BackendInstanceId, RegisteredInstance>,
            ] as const);
          },
        );

        if (action._tag === "Absent") return;
        if (action._tag === "Wait") {
          yield* Deferred.await(action.done);
          return;
        }

        const finish = SynchronizedRef.modifyEffect(instancesRef, (current) => {
          const closing = current.get(id);
          if (closing?._tag !== "Closing" || closing.done !== done) {
            return Effect.succeed([undefined, current] as const);
          }
          const next = new Map(current);
          next.delete(id);
          return Effect.succeed([
            undefined,
            next as ReadonlyMap<BackendInstanceId, RegisteredInstance>,
          ] as const);
        }).pipe(Effect.andThen(Deferred.succeed(done, undefined)), Effect.asVoid);
        yield* Option.match(action.entry.scope, {
          onNone: () => Effect.void,
          onSome: (scope) => Scope.close(scope, Exit.void).pipe(Effect.ignore),
        }).pipe(Effect.ensuring(finish));
      });

    return DesktopBackendPool.of({
      get: (id) =>
        SynchronizedRef.get(instancesRef).pipe(
          Effect.map((instances) => {
            const entry = instances.get(id);
            return entry?._tag === "Active" ? Option.some(entry.instance) : Option.none();
          }),
        ),
      list: SynchronizedRef.get(instancesRef).pipe(
        Effect.map((instances) =>
          Array.from(instances.values()).flatMap((entry) =>
            entry._tag === "Active" ? [entry.instance] : [],
          ),
        ),
      ),
      primary: Effect.succeed(primary),
      register,
      unregister,
    });
  }),
);

export const layerTest = (
  instances: readonly DesktopBackendInstance[],
): Layer.Layer<DesktopBackendPool> =>
  Layer.effect(
    DesktopBackendPool,
    Effect.gen(function* () {
      if (instances.length === 0) {
        return yield* Effect.die("DesktopBackendPool.layerTest requires at least one instance");
      }
      const byId = new Map<BackendInstanceId, DesktopBackendInstance>(
        instances.map((instance) => [instance.id, instance] as const),
      );
      const primary = instances[0]!;
      return DesktopBackendPool.of({
        get: (id) => Effect.succeed(Option.fromNullishOr(byId.get(id))),
        list: Effect.succeed(Array.from(byId.values())),
        primary: Effect.succeed(primary),
        register: () => Effect.die("DesktopBackendPool.layerTest does not support register"),
        unregister: () => Effect.die("DesktopBackendPool.layerTest does not support unregister"),
      });
    }),
  );
