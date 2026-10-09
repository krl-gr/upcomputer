import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { ServerSettingsService } from "../serverSettings.ts";

/**
 * The user's "all chats" instructions (the top-level `customInstructions`
 * setting), as one delimited block every provider session gets in its most
 * system-level channel. Adapters read it through `buildRuntimeInstructions`
 * (Codex through its own additional-context entry), so a change applies to
 * the next session or turn that builds its instructions.
 */
export const USER_INSTRUCTIONS_HEADING = "User instructions (from Up.computer settings)";

let current = "";

/**
 * Returns `undefined` when there is nothing to add.
 *
 * @public Up.computer pro's Pi adapter test builds its expected block with it.
 */
export function formatUserInstructionsBlock(instructions: string): string | undefined {
  const trimmed = instructions.trim();
  return trimmed ? `# ${USER_INSTRUCTIONS_HEADING}\n\n${trimmed}` : undefined;
}

/** The current block, or `undefined` while the user has no instructions. */
export function currentUserInstructionsBlock(): string | undefined {
  return formatUserInstructionsBlock(current);
}

/** Test hook; the server keeps the value in sync with settings through `layer`. */
export function setUserInstructions(instructions: string): void {
  current = instructions;
}

/** Keeps the block in sync with the settings file, including edits made outside the app. */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const settings = yield* ServerSettingsService;
    const changes = yield* settings.subscribeChanges;
    const initial = yield* settings.getSettings.pipe(
      Effect.map((value) => value.customInstructions),
      Effect.catch((cause) =>
        Effect.logWarning("user instructions unavailable", { cause }).pipe(Effect.as("")),
      ),
    );
    setUserInstructions(initial);
    yield* changes.pipe(
      Stream.runForEach((value) =>
        Effect.sync(() => setUserInstructions(value.customInstructions)),
      ),
      Effect.forkScoped,
    );
  }),
);
