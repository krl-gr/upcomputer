import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import {
  setUserInstructions,
  USER_INSTRUCTIONS_HEADING,
} from "@t3tools/provider-core/server/userInstructions";

import {
  materializePiT3McpExtension,
  piUserInstructionsPath,
  writePiUserInstructions,
} from "./mcpInjection.ts";

it.effect("writes the current user instructions for the extension, and nothing once cleared", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const cacheDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-pi-instructions-" });
    const extensionPath = yield* materializePiT3McpExtension(cacheDir);
    const written = Effect.gen(function* () {
      yield* writePiUserInstructions(extensionPath);
      return yield* fs.readFileString(piUserInstructionsPath(extensionPath));
    });
    setUserInstructions("Be brief.");
    assert.equal(yield* written, `# ${USER_INSTRUCTIONS_HEADING}\n\nBe brief.`);
    setUserInstructions("  ");
    assert.equal(yield* written, "");
    // Only the extension and its instructions: no temporary file is left behind.
    assert.equal((yield* fs.readDirectory(cacheDir)).length, 2);
  }).pipe(
    Effect.ensuring(Effect.sync(() => setUserInstructions(""))),
    Effect.scoped,
    Effect.provide(NodeServices.layer),
  ),
);
