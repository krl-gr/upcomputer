import type { ProjectIconColor } from "@t3tools/contracts";

import { projectIconColorClassName } from "../../../../../apps/web/src/projectIconColors.ts";
import { deriveProjectIdentity } from "../../../../../apps/web/src/projectIdentity.ts";
import type { PlannerProject } from "./ProjectChip.tsx";

/**
 * The color of a project's badge in the sidebar: the color picked for its
 * icon, else the one its generated monogram takes from the title. The Inbox
 * has an uncolored icon in the planner, so it has none.
 */
export function plannerProjectColor(project: PlannerProject | null): ProjectIconColor | null {
  if (!project || project.inbox) return null;
  const icon = project.favicon?.projectIcon;
  if (icon && icon.kind !== "emoji") return icon.color;
  return deriveProjectIdentity(project.favicon?.title ?? project.name).color;
}

/** A card's stripe: its project's badge color, neutral without one. */
export function projectStripeClassName(project: PlannerProject | null): string {
  const color = plannerProjectColor(project);
  return color ? `bg-current ${projectIconColorClassName(color)}` : "bg-muted-foreground/60";
}

/**
 * A modern card's surface: its project's badge color mixed into the card
 * color, as the project monogram tints its badge; neutral without one. Opaque,
 * so the hover actions can wear the same surface over the title.
 */
export function projectTintClassName(project: PlannerProject | null): string {
  const color = plannerProjectColor(project);
  const tint = color ? projectIconColorClassName(color) : "text-muted-foreground";
  return `${tint} bg-[color-mix(in_srgb,currentColor_12%,var(--card))]`;
}
