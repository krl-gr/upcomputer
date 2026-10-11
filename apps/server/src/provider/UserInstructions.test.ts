import { assert, it } from "@effect/vitest";
import { buildRuntimeInstructions } from "@t3tools/provider-core/server/runtimeInstructions";
import {
  setUserInstructions,
  USER_INSTRUCTIONS_HEADING,
} from "@t3tools/provider-core/server/userInstructions";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerSettings from "../serverSettings.ts";
import { buildCodexAdditionalContext } from "./CodexDeveloperInstructions.ts";
import * as UserInstructions from "./UserInstructions.ts";

const HEADING = `# ${USER_INSTRUCTIONS_HEADING}`;

// Pi's channel is covered in packages/provider-pi/src/server/mcpInjection.test.ts.
it.effect("every adapter channel carries the all-chats setting, and nothing once it is empty", () =>
  Effect.gen(function* () {
    assert.include(buildRuntimeInstructions({ harness: "Claude Code" }), `${HEADING}\n\nBe brief.`);
    assert.include(buildRuntimeInstructions({ harness: "OpenCode" }), `${HEADING}\n\nBe brief.`);
    const codex = buildCodexAdditionalContext({ model: "gpt", reasoningEffort: "medium" });
    assert.strictEqual(codex.user_instructions?.value, `${HEADING}\n\nBe brief.`);
    // Codex keeps them in their own entry, under its per-entry cap.
    assert.notInclude(codex.t3_code_runtime?.value ?? "", HEADING);

    // The layer applies each settings change the same way.
    setUserInstructions("  ");
    assert.notInclude(buildRuntimeInstructions({ harness: "Claude Code" }), HEADING);
    assert.isUndefined(
      buildCodexAdditionalContext({ model: "gpt", reasoningEffort: "medium" }).user_instructions,
    );
  }).pipe(
    Effect.provide(
      UserInstructions.layer.pipe(
        Layer.provideMerge(ServerSettings.layerTest({ customInstructions: "Be brief." })),
      ),
    ),
    Effect.ensuring(Effect.sync(() => setUserInstructions(""))),
  ),
);
