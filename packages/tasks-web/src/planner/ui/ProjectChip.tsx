import { FolderIcon, InboxIcon } from "lucide-react";

import type { ProjectFaviconProject } from "../../../../../apps/web/src/components/ProjectFavicon.tsx";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../../../../apps/web/src/components/ui/select.tsx";
import { ProjectRowIcon } from "../../../../../apps/web/src/sidebarProjects/sidebarProjectIcons.tsx";

/** A project the planner can put a task in. The Inbox replaces wande's "Unassigned". */
export interface PlannerProject {
  readonly id: string;
  readonly name: string;
  readonly favicon: ProjectFaviconProject | null;
  readonly inbox: boolean;
}

/** The Inbox project lives on `<T3 home>/tasks-inbox` (phase 1); its id is not sent to clients. */
export function isInboxRoot(workspaceRoot: string): boolean {
  return /[/\\]tasks-inbox[/\\]?$/.test(workspaceRoot);
}

/** Select value for "Inbox" before the Inbox project exists: create without a project. */
export const NEW_INBOX = "__new-inbox__";
const MIXED = "__mixed__";

export function ProjectIcon(props: { readonly project: PlannerProject | null }) {
  if (props.project?.inbox || props.project === null) return <InboxIcon className="size-4" />;
  return props.project.favicon ? (
    <ProjectRowIcon project={props.project.favicon} />
  ) : (
    <FolderIcon className="size-4" />
  );
}

/**
 * The project chip of a row, a window and the select-mode header: the
 * project's icon and name, no colors. `value` null is the Inbox not created
 * yet (create windows only); `mixed` is a selection across projects.
 */
export function ProjectChip(props: {
  readonly projects: readonly PlannerProject[];
  readonly value: string | null;
  readonly mixed?: boolean;
  readonly disabled?: boolean;
  /** Offers the Inbox before it exists; only creating a task can make it. */
  readonly allowNewInbox?: boolean;
  readonly onChange: (projectId: string | null) => void;
}) {
  const inbox = props.projects.find((project) => project.inbox) ?? null;
  const others = props.projects.filter((project) => !project.inbox);
  const selected = props.mixed
    ? null
    : (props.projects.find((project) => project.id === props.value) ?? null);
  const value = props.mixed ? MIXED : (props.value ?? NEW_INBOX);
  const unknown = !props.mixed && selected === null && props.value !== null;
  const label = props.mixed
    ? "Mixed"
    : selected
      ? selected.name
      : unknown
        ? "Unknown project"
        : "Inbox";
  return (
    <Select
      value={value}
      disabled={props.disabled}
      onValueChange={(next) => {
        if (!next || next === MIXED || next === value) return;
        props.onChange(next === NEW_INBOX ? null : next);
      }}
    >
      <SelectTrigger
        size="xs"
        className="w-auto min-w-0 max-w-48"
        aria-label="Project"
        data-prevent-drag
      >
        <SelectValue>
          <span className="flex min-w-0 items-center gap-1.5">
            {props.mixed || unknown ? (
              <FolderIcon className="size-4" />
            ) : (
              <ProjectIcon project={selected} />
            )}
            <span className="truncate">{label}</span>
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectPopup>
        {props.mixed ? (
          <SelectItem value={MIXED} disabled>
            Mixed
          </SelectItem>
        ) : null}
        {inbox || props.allowNewInbox ? (
          <SelectItem value={inbox?.id ?? NEW_INBOX}>
            <span className="flex min-w-0 items-center gap-2">
              <InboxIcon className="size-4" />
              <span className="truncate">Inbox</span>
            </span>
          </SelectItem>
        ) : null}
        {others.map((project) => (
          <SelectItem key={project.id} value={project.id}>
            <span className="flex min-w-0 items-center gap-2">
              <ProjectIcon project={project} />
              <span className="truncate">{project.name}</span>
            </span>
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
