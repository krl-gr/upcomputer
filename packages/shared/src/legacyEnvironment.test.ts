import { assert, describe, it } from "@effect/vitest";
import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import {
  normalizeUpcomputerEnvironment,
  readUpcomputerEnvironment,
  withLegacyEnvironment,
} from "./legacyEnvironment.ts";

const config = withLegacyEnvironment(
  Config.all({
    port: Config.port("UPCOMPUTER_PORT").pipe(Config.withDefault(3773)),
    telemetry: Config.boolean("UPCOMPUTER_TELEMETRY_ENABLED").pipe(Config.withDefault(true)),
  }),
);

describe("UpComputer environment compatibility", () => {
  it.effect("reads legacy-only settings before defaults", () =>
    Effect.gen(function* () {
      const value = yield* config.parse(
        ConfigProvider.fromEnv({
          env: {
            T3CODE_PORT: "4001",
            T3CODE_TELEMETRY_ENABLED: "false",
          },
        }),
      );
      assert.deepStrictEqual(value, { port: 4001, telemetry: false });
    }),
  );
  it.effect("prefers explicit current settings including false", () =>
    Effect.gen(function* () {
      const value = yield* config.parse(
        ConfigProvider.fromEnv({
          env: {
            UPCOMPUTER_PORT: "4002",
            T3CODE_PORT: "4001",
            UPCOMPUTER_TELEMETRY_ENABLED: "false",
            T3CODE_TELEMETRY_ENABLED: "true",
          },
        }),
      );
      assert.deepStrictEqual(value, { port: 4002, telemetry: false });
    }),
  );
  it.effect("does not hide a malformed new value behind a valid old one", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        config.parse(
          ConfigProvider.fromEnv({
            env: {
              UPCOMPUTER_PORT: "invalid",
              T3CODE_PORT: "4001",
            },
          }),
        ),
      );
      assert.isTrue(Exit.isFailure(result));
    }),
  );
  it.effect("preserves provider transformations and unrelated names", () =>
    Effect.gen(function* () {
      const provider = ConfigProvider.fromEnv({
        env: {
          APP_T3CODE_PORT: "4100",
          APP_HOST: "localhost",
        },
      }).pipe(ConfigProvider.nested("APP"));
      const value = yield* withLegacyEnvironment(
        Config.all({
          port: Config.port("UPCOMPUTER_PORT"),
          host: Config.string("HOST"),
        }),
      ).parse(provider);
      assert.deepStrictEqual(value, { port: 4100, host: "localhost" });
    }),
  );
  it.effect("uses defaults if neither spelling exists", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* config.parse(ConfigProvider.fromEnv({ env: {} })), {
        port: 3773,
        telemetry: true,
      });
    }),
  );
  it("normalizes an input without mutating it or replacing explicit empty values", () => {
    const source = {
      T3CODE_PORT: "4001",
      UPCOMPUTER_PORT: "",
      T3CODE_MODE: "desktop",
      OTHER: "value",
    };
    const result = normalizeUpcomputerEnvironment(source);
    assert.equal(result.UPCOMPUTER_PORT, "");
    assert.equal(result.UPCOMPUTER_MODE, "desktop");
    assert.equal(result.OTHER, "value");
    assert.notProperty(source, "UPCOMPUTER_MODE");
    assert.equal(readUpcomputerEnvironment(source, "UPCOMPUTER_PORT"), "");
    assert.equal(readUpcomputerEnvironment(source, "UPCOMPUTER_MODE"), "desktop");
  });
});
