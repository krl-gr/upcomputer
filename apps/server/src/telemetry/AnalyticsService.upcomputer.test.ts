import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import type { ManagedPolicyDocument } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import * as ServerConfig from "../config.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as AnalyticsService from "./AnalyticsService.ts";

const SentBatch = Schema.fromJsonString(
  Schema.Struct({
    batch: Schema.Array(
      Schema.Struct({
        event: Schema.String,
        distinct_id: Schema.String,
        properties: Schema.Struct({ installId: Schema.optionalKey(Schema.String) }),
      }),
    ),
  }),
);
type SentEvent = (typeof SentBatch.Type)["batch"][number];
const decodeSentBatch = Schema.decodeEffect(SentBatch);

const POLICY_OFF: ManagedPolicyDocument = {
  schemaVersion: 1,
  organization: "Example Corp",
  limits: { telemetry: false },
};

/** Runs `use` against a server whose state lives in `baseDir`, and returns every event it sent. */
const runServer = <A, E>(
  baseDir: string,
  use: (analytics: AnalyticsService.AnalyticsService["Service"]) => Effect.Effect<A, E>,
  options: { readonly envEnabled?: boolean; readonly policy?: ManagedPolicyDocument } = {},
) =>
  Effect.gen(function* () {
    const sent: Array<SentEvent> = [];
    const client = HttpClient.make((request) =>
      Effect.gen(function* () {
        if (request.body._tag === "Uint8Array") {
          const body = yield* decodeSentBatch(new TextDecoder().decode(request.body.body)).pipe(
            Effect.orDie,
          );
          sent.push(...body.batch);
        }
        return HttpClientResponse.fromWeb(request, new Response(null, { status: 204 }));
      }),
    );
    const result = yield* Effect.flatMap(AnalyticsService.AnalyticsService, use).pipe(
      Effect.provide(
        AnalyticsService.layer.pipe(
          Layer.provideMerge(ServerConfig.ServerConfig.layerTest(process.cwd(), baseDir)),
          Layer.provide(
            ConfigProvider.layer(
              ConfigProvider.fromUnknown({
                T3CODE_TELEMETRY_ENABLED: options.envEnabled ?? true,
                T3CODE_POSTHOG_KEY: "phc_test_key",
                T3CODE_POSTHOG_HOST: "http://localhost",
              }),
            ),
          ),
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(HostProcess.Platform, "darwin"),
              Layer.succeed(HostProcess.Architecture, "arm64"),
              Layer.succeed(HttpClient.HttpClient, client),
              ManagedPolicy.layerTest(options.policy),
            ),
          ),
        ),
      ),
    );
    return { result, sent };
  });

const tempBaseDir = Effect.flatMap(FileSystem.FileSystem, (fileSystem) =>
  fileSystem.makeTempDirectoryScoped({ prefix: "t3-telemetry-preference-" }),
);

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))("telemetry preference", (it) => {
  it.effect("an environment opt-out or a policy wins over the setting", () =>
    Effect.gen(function* () {
      const baseDir = yield* tempBaseDir;
      const unlocked = yield* runServer(baseDir, (analytics) => analytics.preference);
      assert.deepEqual(unlocked.result, { enabled: true, lockedBy: null });

      const byEnvironment = yield* runServer(
        baseDir,
        (analytics) =>
          Effect.gen(function* () {
            const turnedOn = yield* analytics.setUserEnabled(true);
            yield* analytics.record("test.locked");
            yield* analytics.flush;
            return turnedOn;
          }),
        { envEnabled: false },
      );
      assert.deepEqual(byEnvironment.result, { enabled: false, lockedBy: "environment" });
      assert.deepEqual(byEnvironment.sent, []);

      const byPolicy = yield* runServer(baseDir, (analytics) => analytics.setUserEnabled(true), {
        policy: POLICY_OFF,
      });
      assert.deepEqual(byPolicy.result, { enabled: false, lockedBy: "policy" });
      assert.deepEqual(byPolicy.sent, []);

      // Both off: the organization's policy is the reason shown.
      const both = yield* runServer(baseDir, (analytics) => analytics.preference, {
        envEnabled: false,
        policy: POLICY_OFF,
      });
      assert.deepEqual(both.result, { enabled: false, lockedBy: "policy" });
    }),
  );

  it.effect("turning it off drops buffered events and sends nothing, not even a notice", () =>
    Effect.gen(function* () {
      const baseDir = yield* tempBaseDir;
      const { result, sent } = yield* runServer(baseDir, (analytics) =>
        Effect.gen(function* () {
          yield* analytics.record("test.before_opt_out");
          const preference = yield* analytics.setUserEnabled(false);
          yield* analytics.record("test.after_opt_out");
          yield* analytics.recordMilestone("app.first_message_sent");
          yield* analytics.flush;
          return preference;
        }),
      );

      assert.deepEqual(result, { enabled: false, lockedBy: null });
      // server.started was buffered before the switch, so it goes too; the stop is not sent.
      assert.deepEqual(sent, []);
    }),
  );

  it.effect("the choice survives a restart, and turning it back on keeps the install id", () =>
    Effect.gen(function* () {
      const baseDir = yield* tempBaseDir;
      const first = yield* runServer(baseDir, (analytics) =>
        Effect.gen(function* () {
          yield* analytics.flush;
          yield* analytics.setUserEnabled(false);
        }),
      );
      const installId = first.sent[0]?.properties.installId;
      assert.isString(installId);

      const restarted = yield* runServer(baseDir, (analytics) =>
        Effect.gen(function* () {
          const preference = yield* analytics.preference;
          yield* analytics.record("test.while_off");
          yield* analytics.flush;
          const turnedOn = yield* analytics.setUserEnabled(true);
          yield* analytics.record("test.back_on");
          yield* analytics.flush;
          return { preference, turnedOn };
        }),
      );

      assert.deepEqual(restarted.result, {
        preference: { enabled: false, lockedBy: null },
        turnedOn: { enabled: true, lockedBy: null },
      });
      const backOn = restarted.sent.filter((event) => event.event === "test.back_on");
      assert.lengthOf(backOn, 1);
      assert.equal(backOn[0]?.properties.installId, installId);
      assert.equal(backOn[0]?.distinct_id, installId);
      assert.isFalse(restarted.sent.some((event) => event.event === "test.while_off"));
      assert.isFalse(restarted.sent.some((event) => event.event === "server.started"));
    }),
  );
});
