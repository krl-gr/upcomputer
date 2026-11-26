import type { EnvironmentId, ScopedProjectRef } from "@t3tools/contracts";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";

import { BotsSection } from "../../bots/BotsSection";
import {
  SidebarComputersGroup,
  SidebarProjectsGroup,
  type SidebarComputer,
  type SidebarProject,
} from "./SidebarPickGroups";

/**
 * The desktop sidebar's groups above the threads, in its order: Computers (from a second
 * computer on), Projects and Bots. Pinned and Threads head the list's own rows.
 */
export function ChatsSidebarGroups(props: {
  readonly computers: ReadonlyArray<SidebarComputer>;
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly onEnvironmentChange: (environmentId: EnvironmentId | null) => void;
  readonly projects: ReadonlyArray<SidebarProject>;
  readonly selectedProjectKey: string | null;
  readonly onProjectChange: (key: string | null) => void;
  readonly onNewChat: (project: EnvironmentProject) => void;
  readonly botEnvironmentIds: ReadonlyArray<EnvironmentId>;
  readonly botProjectRefs: ReadonlyArray<ScopedProjectRef> | null;
  readonly query: string;
}) {
  return (
    <>
      <SidebarComputersGroup
        computers={props.computers}
        selectedEnvironmentId={props.selectedEnvironmentId}
        onSelect={props.onEnvironmentChange}
      />
      <SidebarProjectsGroup
        projects={props.projects}
        selectedKey={props.selectedProjectKey}
        onSelect={props.onProjectChange}
        onNewChat={props.onNewChat}
      />
      <BotsSection
        environmentIds={props.botEnvironmentIds}
        projectRefs={props.botProjectRefs}
        query={props.query}
      />
    </>
  );
}
