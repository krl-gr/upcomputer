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
