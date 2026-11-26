import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import { View } from "react-native";

import { ProjectFavicon } from "../../components/ProjectFavicon";
import { SymbolView } from "../../components/ui/AppSymbol";

/** A task's project as the desktop's table shows it: the project's badge, or a folder. */
export function TaskProjectBadge(props: {
  readonly environmentId: EnvironmentId;
  readonly project: EnvironmentProject | null;
  readonly size: number;
}) {
  if (props.project === null || props.project.isScratch)
    return (
      <View
        style={{ width: props.size, height: props.size }}
        className="items-center justify-center"
      >
        <SymbolView
          name={props.project ? { ios: "tray", android: "folder" } : "folder"}
          size={props.size * 0.75}
          tintColorClassName="accent-icon-muted"
        />
      </View>
    );
  return (
    <ProjectFavicon
      environmentId={props.environmentId}
      faviconPath={props.project.faviconPath}
      projectIcon={props.project.projectIcon}
      size={props.size}
      projectTitle={props.project.title}
      workspaceRoot={props.project.workspaceRoot}
    />
  );
}
