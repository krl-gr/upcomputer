/**
 * Home with no projects: opens the scratch project, then its draft in place of
 * "/". Opening the scratch project can be slow, so the draft opens only if home
 * is still the page the user is on once it resolves; otherwise it would replace
 * the page they picked meanwhile.
 */
export async function openScratchHomeDraft<Project, Opened>(input: {
  readonly openScratchProject: () => Promise<Project | null>;
  readonly isStillHome: () => boolean;
  readonly openDraft: (project: Project) => Promise<Opened | null>;
}): Promise<"opened" | "failed" | "left"> {
  const project = await input.openScratchProject();
  if (project === null) return "failed";
  if (!input.isStillHome()) return "left";
  return (await input.openDraft(project)) === null ? "failed" : "opened";
}

/**
 * Home with no project to open and no scratch chat on offer. Upstream shows
 * the "Add a project" hero. UpComputer shows it only once every environment
 * sent its live data, as before that "nothing to open" is a guess: a blank
 * page during the first load, then what it is waiting for.
 */
export function resolveHomeWithoutDraft(input: {
  readonly startsWithoutProject: boolean;
  readonly workspaceSettled: boolean;
  readonly workspaceDelivered: boolean;
}): "hero" | "pending" | "waiting" {
  if (!input.startsWithoutProject || input.workspaceDelivered) return "hero";
  return input.workspaceSettled ? "waiting" : "pending";
}
