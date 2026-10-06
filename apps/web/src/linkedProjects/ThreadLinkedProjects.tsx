import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import { LinkIcon } from "lucide-react";
import { useMemo } from "react";

import { showsUpComputerComposerContextRow } from "../composerContextRow/composerContextRowSurface";
import { ProjectFavicon } from "../components/ProjectFavicon";
import { Button } from "../components/ui/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuTrigger,
} from "../components/ui/menu";
import type { ExperimentalWebThreadAccessoryProps } from "../product/WebFeature";
import { useProjects, useServerConfigs, useThreadShell } from "../state/entities";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";

const MAX_HEADER_ICONS = 3;

/**
 * The thread's linked projects in the chat header. With the UpComputer row
 * under the composer, that row shows and changes them instead.
 */
export default function ThreadLinkedProjects(props: ExperimentalWebThreadAccessoryProps) {
  if (showsUpComputerComposerContextRow()) return null;
  return <ThreadLinkedProjectsMenu {...props} />;
}

/**
 * The thread's linked projects as icons, and a menu of the environment's other
 * projects to link or unlink. Links put the thread under those projects in the
 * sidebar and give its agent their folders from its next turn.
 */
function ThreadLinkedProjectsMenu(props: ExperimentalWebThreadAccessoryProps) {
  const thread = useThreadShell(
    useMemo(() => scopeThreadRef(props.environmentId, props.threadId), [props]),
  );
  const projects = useProjects();
  const scratchRoot = useServerConfigs().get(props.environmentId)?.scratchWorkspaceRoot;
  const updateMetadata = useAtomCommand(threadEnvironment.updateMetadata);
  if (thread === null) return null;
  const linked = new Set<string>(thread.linkedProjectIds ?? []);
  const candidates = projects.filter(
    (project) =>
      project.environmentId === props.environmentId &&
      project.id !== thread.projectId &&
      !isScratchProject(project, scratchRoot),
  );
  if (candidates.length === 0) return null;
  const linkedProjects = candidates.filter((project) => linked.has(project.id));
  const label =
    linkedProjects.length === 0
      ? "Link projects"
      : `Linked projects: ${linkedProjects.map((project) => project.title).join(", ")}`;
  return (
    <Menu>
      <MenuTrigger render={<Button variant="ghost" size="compact" aria-label={label} />}>
        {linkedProjects.length === 0 ? (
          <LinkIcon />
        ) : (
          linkedProjects
            .slice(0, MAX_HEADER_ICONS)
            .map((project) => (
              <ProjectFavicon key={project.id} project={project} className="size-3.5" />
            ))
        )}
        {linkedProjects.length > MAX_HEADER_ICONS ? (
          <span className="tabular-nums">+{linkedProjects.length - MAX_HEADER_ICONS}</span>
        ) : null}
      </MenuTrigger>
      <MenuPopup align="start" side="bottom">
        <MenuGroup>
          <MenuGroupLabel>Linked projects</MenuGroupLabel>
          {candidates.map((project) => (
            <MenuCheckboxItem
              key={project.id}
              checked={linked.has(project.id)}
              onCheckedChange={(checked) =>
                void updateMetadata({
                  environmentId: props.environmentId,
                  input: {
                    threadId: props.threadId,
                    ...(checked
                      ? { linkProjectIds: [project.id] }
                      : { unlinkProjectIds: [project.id] }),
                  },
                })
              }
            >
              <ProjectFavicon project={project} className="size-4" />
              <span className="truncate">{project.title}</span>
            </MenuCheckboxItem>
          ))}
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}
