/**
 * Which of upstream's workspace controls the row under the composer shows: the
 * environment, and the checkout mode with the branch. The scratch folder is not
 * a project checkout, so it shows neither. With none, the row and its space
 * under the composer go away (`hasContextRowControls`).
 */
export function resolveContextRowControls(input: {
  readonly isGitRepo: boolean;
  readonly isScratch: boolean;
  readonly showEnvironmentIndicator: boolean;
}): { readonly environment: boolean; readonly git: boolean } {
  return {
    environment: !input.isScratch && input.showEnvironmentIndicator,
    git: input.isGitRepo && !input.isScratch,
  };
}

export function hasContextRowControls(
  controls: ReturnType<typeof resolveContextRowControls>,
): boolean {
  return controls.environment || controls.git;
}
