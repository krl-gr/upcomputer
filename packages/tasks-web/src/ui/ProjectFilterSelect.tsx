import type { ReactNode } from "react";

import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../../../apps/web/src/components/ui/select.tsx";
import type { SidebarProjectSnapshot } from "../../../../apps/web/src/sidebarProjectGrouping.ts";
import {
  AllProjectsIcon,
  NoProjectIcon,
  ProjectRowIcon,
  useSidebarScratchProject,
} from "../../../../apps/web/src/sidebarProjects/sidebarProjectIcons.tsx";
import { ALL_FILTER } from "./pageFilters.ts";

interface ProjectOption {
  readonly value: string;
  readonly label: string;
  readonly icon: ReactNode;
}

/**
 * Options with the sidebar Projects section's icons: All projects, No project
 * (the primary Scratch project), then the other projects in the sidebar's order.
 */
export function projectFilterOptions(input: {
  readonly projectGroups: ReadonlyArray<SidebarProjectSnapshot>;
  readonly scratch: SidebarProjectSnapshot | null;
}): ProjectOption[] {
  const { scratch } = input;
  return [
    { value: ALL_FILTER, label: "All projects", icon: <AllProjectsIcon /> },
    ...(scratch
      ? [{ value: scratch.projectKey, label: "No project", icon: <NoProjectIcon /> }]
      : []),
    ...input.projectGroups
      .filter((project) => project !== scratch)
      .map((project) => ({
        value: project.projectKey,
        label: project.displayName,
        icon: <ProjectRowIcon project={project} />,
      })),
  ];
}

function OptionLabel(props: { readonly option: ProjectOption }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {props.option.icon}
      <span className="truncate">{props.option.label}</span>
    </span>
  );
}

/** Project select at the right of the Tasks, Agents and Automations headers. */
export function ProjectFilterSelect(props: {
  readonly projectGroups: ReadonlyArray<SidebarProjectSnapshot>;
  /** Logical project key, or null for All projects. */
  readonly value: string | null;
  readonly onChange: (projectKey: string | null) => void;
}) {
  const scratch = useSidebarScratchProject(props.projectGroups);
  const options = projectFilterOptions({ projectGroups: props.projectGroups, scratch });
  const value = options.some((option) => option.value === props.value)
    ? (props.value ?? ALL_FILTER)
    : ALL_FILTER;
  const selected = options.find((option) => option.value === value) ?? options[0]!;
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next) props.onChange(next === ALL_FILTER ? null : next);
      }}
    >
      {/* Shrinks toward its icon when the header runs short, so it stays in reach. */}
      <SelectTrigger className="w-44 min-w-16 shrink" size="sm" aria-label="Filter by project">
        <SelectValue>
          <OptionLabel option={selected} />
        </SelectValue>
      </SelectTrigger>
      <SelectPopup>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            <OptionLabel option={option} />
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
