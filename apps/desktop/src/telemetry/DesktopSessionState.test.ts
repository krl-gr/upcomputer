import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  DESKTOP_SESSION_STATE_FILE,
  DesktopSessionState as StateSchema,
  type ManagedPolicyDocument,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopManagedPolicy from "../app/DesktopManagedPolicy.ts";
import * as DesktopSessionState from "./DesktopSessionState.ts";

const decodeState = Schema.decodeUnknownEffect(Schema.fromJsonString(StateSchema));

const makeState = Effect.fn(function* (options?: {
  readonly env?: NodeJS.ProcessEnv;
  readonly policy?: ManagedPolicyDocument;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const stateDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-session-state-" });
  const file = path.join(stateDir, DESKTOP_SESSION_STATE_FILE);
  const state = yield* DesktopSessionState.DesktopSessionState.pipe(
    Effect.provide(
      DesktopSessionState.layer.pipe(
        Layer.provide(DesktopManagedPolicy.layerTest(options?.policy)),
        Layer.provide(
          Layer.succeed(DesktopEnvironment.DesktopEnvironment, {
            path,
            stateDir,
          } as DesktopEnvironment.DesktopEnvironment["Service"]),
        ),
      ),
    ),
    Effect.provideService(HostProcess.Environment, options?.env ?? {}),
  );
  const readLast = fileSystem.readFileString(file).pipe(
    Effect.flatMap(decodeState),
    Effect.map((written) => written.last),
  );
  return { state, file, readLast };
});

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))("DesktopSessionState", (it) => {
  it.effect("keeps the session's last state where the backend reads it, unless opted out", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const env: NodeJS.ProcessEnv = {};
      const { state, file } = yield* makeState({ env });

      state.recordUnsafe({ state: "backend_exited", code: 3, signal: null });
      const written = yield* decodeState(yield* fileSystem.readFileString(file));
      assert.equal(written.sessionId, state.sessionId);
      assert.deepEqual(written.last, { state: "backend_exited", code: 3, signal: null });

      // The opt-out can arrive later, from the login shell's environment.
      env.T3CODE_TELEMETRY_ENABLED = "false";
      state.recordUnsafe({ state: "suspended" });
      assert.deepEqual(
        (yield* decodeState(yield* fileSystem.readFileString(file))).last,
        written.last,
      );
    }),
  );

  it.effect("writes nothing when a managed policy turns telemetry off", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const { state, file } = yield* makeState({
        policy: { schemaVersion: 1, organization: "Acme", limits: { telemetry: false } },
      });

      state.recordUnsafe({ state: "suspended" });
      assert.isFalse(yield* fileSystem.exists(file));
    }),
  );

  it.effect("keeps os_shutdown when the OS then kills the renderer and the backend", () =>
    Effect.gen(function* () {
      const { state, readLast } = yield* makeState();

      state.recordUnsafe({ state: "os_shutdown" });
      state.recordUnsafe({ state: "renderer_gone", reason: "killed", exitCode: 0 });
      state.recordUnsafe({ state: "backend_exited", code: null, signal: "SIGTERM" });
      state.recordUnsafe({ state: "running" });
      assert.deepEqual(yield* readLast, { state: "os_shutdown" });
    }),
  );

  it.effect("forgets a renderer crash once the main window is back, and only that", () =>
    Effect.gen(function* () {
      const { state, readLast } = yield* makeState();

      state.recordUnsafe({ state: "renderer_gone", reason: "crashed", exitCode: 11 });
      state.recoveredUnsafe("renderer_gone");
      assert.deepEqual(yield* readLast, { state: "running" });

      state.recordUnsafe({ state: "backend_exited", code: 1, signal: null });
      state.recoveredUnsafe("renderer_gone");
      assert.deepEqual(yield* readLast, { state: "backend_exited", code: 1, signal: null });
    }),
  );
});
