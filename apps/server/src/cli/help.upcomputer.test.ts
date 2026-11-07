import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NetService from "@t3tools/shared/Net";
import { UPCOMPUTER_PRODUCT_FLAGS } from "@t3tools/shared/productFlags";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestConsole from "effect/testing/TestConsole";
import { Command } from "effect/cli";

import { makeCli } from "../binCli.ts";

const helpText = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    yield* Command.runWith(
      makeCli({ cloudEnabled: true, triage: UPCOMPUTER_PRODUCT_FLAGS.triage }),
      { version: "0.0.0" },
    )(args);
    return (yield* TestConsole.logLines).join("\n");
  }).pipe(
    Effect.provide(
      Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, NetService.layer, TestConsole.layer),
    ),
  );

describe("up --help", () => {
  it.effect.each([
    { args: ["--help"] },
    { args: ["remote", "--help"] },
    { args: ["connect", "--help"] },
  ])("names Up.computer, not T3: up $args", ({ args }) =>
    Effect.gen(function* () {
      const text = yield* helpText(args);
      assert.include(text, "up");
      // Environment variable names such as T3CODE_HOME are real config names and stay.
      assert.notMatch(text, /\bT3\b|\bt3\b/);
      if (args[0] === "--help") assert.notMatch(text, /^\s*triage\b/m);
    }),
  );
});
