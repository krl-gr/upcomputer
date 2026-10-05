/**
 * Rows of the sidebar's Projects section (UpComputer). The section filters
 * through upstream's project scope, so its rows are project scope keys.
 */

/** Projects shown before "More". */
export const SIDEBAR_PROJECT_PREVIEW_COUNT = 3;

export interface SidebarProjectsRows<TProject> {
  /** The first projects in the sidebar's project order, plus the selected one. */
  readonly preview: ReadonlyArray<TProject>;
  /** The Scratch project, shown as "No project". */
  readonly scratch: TProject | null;
  /** Everything else, for "More". */
  readonly overflow: ReadonlyArray<TProject>;
}

/**
 * Splits the sidebar's ordered project groups into rows. A selected project
 * past the preview takes the last preview slot, so the active filter stays
 * visible. With one Scratch project per environment, the primary
 * environment's is "No project" and any other one is an ordinary project.
 */
export function buildSidebarProjectsRows<TProject extends { readonly projectKey: string }>(input: {
  readonly projects: ReadonlyArray<TProject>;
  readonly selectedProjectKey: string | null;
  readonly isScratch: (project: TProject) => boolean;
  readonly isPrimary: (project: TProject) => boolean;
  readonly limit?: number;
}): SidebarProjectsRows<TProject> {
  const limit = input.limit ?? SIDEBAR_PROJECT_PREVIEW_COUNT;
  const scratchProjects = input.projects.filter(input.isScratch);
  const scratch = scratchProjects.find(input.isPrimary) ?? scratchProjects[0] ?? null;
  const projects = input.projects.filter((project) => project !== scratch);
  let preview = projects.slice(0, limit);
  const selected = projects.find((project) => project.projectKey === input.selectedProjectKey);
  if (selected !== undefined && limit > 0 && !preview.includes(selected)) {
    preview = [...preview.slice(0, limit - 1), selected];
  }
  return {
    preview,
    scratch,
    overflow: projects.filter((project) => !preview.includes(project)),
  };
}
