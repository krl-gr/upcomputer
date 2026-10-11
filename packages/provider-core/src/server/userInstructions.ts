/**
 * The user's "all chats" instructions (the top-level `customInstructions`
 * setting), as one delimited block every provider session gets in its most
 * system-level channel. Adapters read it through `buildRuntimeInstructions`
 * (Codex through its own additional-context entry, Pi through its extension),
 * so a change applies to the next session or turn that builds its
 * instructions. The server keeps the value in sync with its settings
 * (`apps/server/src/provider/UserInstructions.ts`).
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

/** Set by the server from its settings; tests set it directly. */
export function setUserInstructions(instructions: string): void {
  current = instructions;
}
