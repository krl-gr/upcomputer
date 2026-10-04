import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { buildPiRpcLaunch } from "../orchestration-v2/Adapters/piT3McpInjection.ts";
import { T3_PI_USER_INSTRUCTIONS_ENV } from "../orchestration-v2/Adapters/piT3McpExtensionSource.ts";
import * as ServerSettings from "../serverSettings.ts";
import { buildCodexAdditionalContext } from "./CodexDeveloperInstructions.ts";
import { buildRuntimeInstructions } from "./RuntimeInstructions.ts";
import * as UserInstructions from "./UserInstructions.ts";

const HEADING = `# ${UserInstructions.USER_INSTRUCTIONS_HEADING}`;

it.effect("every adapter channel carries the all-chats setting, and nothing once it is empty", () =>
  Effect.gen(function* () {
    assert.include(buildRuntimeInstructions({ harness: "Claude Code" }), `${HEADING}\n\nBe brief.`);
    const codex = buildCodexAdditionalContext({ model: "gpt", reasoningEffort: "medium" });
    assert.strictEqual(codex.user_instructions?.value, `${HEADING}\n\nBe brief.`);
    // Codex keeps them in their own entry, under its per-entry cap.
    assert.notInclude(codex.t3_code_runtime?.value ?? "", HEADING);
    const pi = buildPiRpcLaunch({
      launchArgs: [],
      environment: { [T3_PI_USER_INSTRUCTIONS_ENV]: "inherited" },
      mcpSession: undefined,
      extensionPath: "/cache/pi-t3-mcp-extension.ts",
    });
    assert.strictEqual(pi.env[T3_PI_USER_INSTRUCTIONS_ENV], `${HEADING}\n\nBe brief.`);

    // The layer applies each settings change the same way.
    UserInstructions.setUserInstructions("  ");
    assert.notInclude(buildRuntimeInstructions({ harness: "Claude Code" }), HEADING);
    assert.isUndefined(
      buildCodexAdditionalContext({ model: "gpt", reasoningEffort: "medium" }).user_instructions,
    );
    const piWithout = buildPiRpcLaunch({
      launchArgs: [],
      environment: { [T3_PI_USER_INSTRUCTIONS_ENV]: "inherited" },
      mcpSession: undefined,
      extensionPath: "/cache/pi-t3-mcp-extension.ts",
    });
    assert.isUndefined(piWithout.env[T3_PI_USER_INSTRUCTIONS_ENV]);
  }).pipe(
    Effect.provide(
      UserInstructions.layer.pipe(
        Layer.provideMerge(ServerSettings.layerTest({ customInstructions: "Be brief." })),
      ),
    ),
    Effect.ensuring(Effect.sync(() => UserInstructions.setUserInstructions(""))),
  ),
);
