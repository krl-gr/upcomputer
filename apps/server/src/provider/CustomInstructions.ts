/**
 * The user's custom instructions from Up.computer settings, as one delimited
 * block. Each adapter appends it to its most system-level channel.
 */
export const CUSTOM_INSTRUCTIONS_HEADING = "User instructions (from Up.computer settings)";

/** Returns `undefined` when there is nothing to add, so callers keep today's output. */
export function formatCustomInstructionsBlock(
  instructions: string | undefined,
): string | undefined {
  const trimmed = instructions?.trim();
  return trimmed ? `# ${CUSTOM_INSTRUCTIONS_HEADING}\n\n${trimmed}` : undefined;
}

export function appendCustomInstructions(base: string, instructions: string | undefined): string {
  const block = formatCustomInstructionsBlock(instructions);
  return block === undefined ? base : `${base}\n\n${block}`;
}
