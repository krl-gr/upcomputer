import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { DESKTOP_SESSION_STATE_FILE, DesktopSessionState as StateSchema } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopSessionState from "./DesktopSessionState.ts";

const decodeState = Schema.decodeUnknownEffect(Schema.fromJsonString(StateSchema));

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))("DesktopSessionState", (it) => {
  it.effect("keeps the session's last state where the backend reads it, unless opted out", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const stateDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-session-state-" });
      const file = path.join(stateDir, DESKTOP_SESSION_STATE_FILE);
      const env: NodeJS.ProcessEnv = {};
      const state = yield* DesktopSessionState.DesktopSessionState.pipe(
        Effect.provide(
          DesktopSessionState.layer.pipe(
            Layer.provide(
              Layer.succeed(DesktopEnvironment.DesktopEnvironment, {
                path,
                stateDir,
              } as DesktopEnvironment.DesktopEnvironment["Service"]),
            ),
          ),
        ),
        Effect.provideService(HostProcess.Environment, env),
      );

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
});
