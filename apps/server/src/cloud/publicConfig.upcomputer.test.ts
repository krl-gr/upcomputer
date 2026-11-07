import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";

import { threadLinkAppUrlConfig } from "./publicConfig.ts";

const provideEnv = (env: Readonly<Record<string, string>>) =>
  Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env })));

it.effect("thread links for outside MCP clients open the hosted app, not the site", () =>
  Effect.gen(function* () {
    assert.equal(yield* threadLinkAppUrlConfig.pipe(provideEnv({})), "https://app.up.computer");
    assert.equal(
      yield* threadLinkAppUrlConfig.pipe(
        provideEnv({ T3CODE_HOSTED_APP_URL: "https://hosted.example.test" }),
      ),
      "https://hosted.example.test",
    );
  }),
);
