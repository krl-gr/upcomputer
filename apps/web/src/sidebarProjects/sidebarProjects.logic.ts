/**
 * Rows of the sidebar's Projects section (UpComputer). The section filters
 * through upstream's project scope, so its rows are project scope keys.
 */

/** Rows shown before "More". */
const SIDEBAR_PROJECT_PREVIEW_COUNT = 3;

/** All projects' row key, also its entry in the manual project order. */
export const ALL_PROJECTS_ROW_KEY = "upcomputer:all-projects";

export type SidebarProjectsRow<TProject> =
  | { readonly kind: "all"; readonly key: string }
  | {
      /** "scratch" is the primary environment's Scratch project, shown as "No project". */
      readonly kind: "scratch" | "project";
      readonly key: string;
      readonly project: TProject;
    };

export interface SidebarProjectsRows<TProject> {
  /** The first rows, plus the selected one. */
  readonly preview: ReadonlyArray<SidebarProjectsRow<TProject>>;
  /** Everything else, for "More". */
  readonly overflow: ReadonlyArray<SidebarProjectsRow<TProject>>;
}

/**
 * The Scratch project "No project" stands for: with one Scratch project per
 * environment, the primary environment's, and any other one is an ordinary project.
 */
export function primaryScratchProject<TProject>(input: {
  readonly projects: ReadonlyArray<TProject>;
  readonly isScratch: (project: TProject) => boolean;
  readonly isPrimary: (project: TProject) => boolean;
}): TProject | null {
  const scratchProjects = input.projects.filter(input.isScratch);
  return scratchProjects.find(input.isPrimary) ?? scratchProjects[0] ?? null;
}

/**
 * One order of All projects, No project and the projects, split into rows. Rows
 * in `heldOrder` (the order on screen) keep it in their slots; new rows keep their
 * own. A selected row past the preview takes the last slot, so it stays visible.
 */
export function buildSidebarProjectsRows<TProject extends { readonly projectKey: string }>(input: {
  /** The sidebar's project groups, in its project order. */
  readonly projects: ReadonlyArray<TProject>;
  /** All projects' place among `projects`: first, or from `manualAllProjectsIndex`. */
  readonly allProjectsIndex: number;
  /** The selected row's key: a project key, or `ALL_PROJECTS_ROW_KEY`. */
  readonly selectedKey: string;
  readonly isScratch: (project: TProject) => boolean;
  readonly isPrimary: (project: TProject) => boolean;
  readonly heldOrder?: ReadonlyArray<string> | null;
  readonly limit?: number;
}): SidebarProjectsRows<TProject> {
  if (input.projects.length === 0) return { preview: [], overflow: [] };
  const limit = input.limit ?? SIDEBAR_PROJECT_PREVIEW_COUNT;
  const scratch = primaryScratchProject(input);
  const projectRows = input.projects.map((project): SidebarProjectsRow<TProject> => ({
    kind: project === scratch ? "scratch" : "project",
    key: project.projectKey,
    project,
  }));
  const allIndex = Math.min(Math.max(input.allProjectsIndex, 0), projectRows.length);
  let rows: ReadonlyArray<SidebarProjectsRow<TProject>> = [
    ...projectRows.slice(0, allIndex),
    { kind: "all", key: ALL_PROJECTS_ROW_KEY },
    ...projectRows.slice(allIndex),
  ];
  if (input.heldOrder) rows = holdOrder(rows, input.heldOrder);
  let preview = rows.slice(0, limit);
  const selected = rows.find((row) => row.key === input.selectedKey);
  if (selected !== undefined && limit > 0 && !preview.includes(selected)) {
    preview = [...preview.slice(0, limit - 1), selected];
  }
  return { preview, overflow: rows.filter((row) => !preview.includes(row)) };
}

function holdOrder<TRow extends { readonly key: string }>(
  rows: ReadonlyArray<TRow>,
  heldOrder: ReadonlyArray<string>,
): ReadonlyArray<TRow> {
  const heldIndex = new Map(heldOrder.map((key, index) => [key, index] as const));
  const held = rows
    .filter((row) => heldIndex.has(row.key))
    .toSorted((left, right) => heldIndex.get(left.key)! - heldIndex.get(right.key)!);
  let next = 0;
  return rows.map((row) => (heldIndex.has(row.key) ? held[next++]! : row));
}

/**
 * All projects' place in the manual order: before the first project listed
 * after its entry. Without an entry it comes first, as on a fresh install.
 */
export function manualAllProjectsIndex(input: {
  readonly projectOrder: ReadonlyArray<string>;
  /** Each project's order keys, in the projects' order. */
  readonly projectOrderKeys: ReadonlyArray<ReadonlyArray<string>>;
}): number {
  const allIndex = input.projectOrder.indexOf(ALL_PROJECTS_ROW_KEY);
  if (allIndex < 0) return 0;
  const orderIndex = new Map(input.projectOrder.map((key, index) => [key, index] as const));
  return input.projectOrderKeys.filter((keys) =>
    keys.some((key) => (orderIndex.get(key) ?? Number.POSITIVE_INFINITY) < allIndex),
  ).length;
}

/**
 * The manual order to reorder from after a drag: the rows as shown, each as
 * its order keys, then the rest of the stored order (projects on other computers).
 */
export function sidebarProjectsDragOrder(input: {
  readonly rowOrderKeys: ReadonlyArray<ReadonlyArray<string>>;
  readonly projectOrder: ReadonlyArray<string>;
}): string[] {
  const shown = input.rowOrderKeys.flat();
  const shownSet = new Set(shown);
  return [...shown, ...input.projectOrder.filter((key) => !shownSet.has(key))];
}
