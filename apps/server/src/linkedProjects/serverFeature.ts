import { defineExperimentalServerFeature, eraseExperimentalServerLayer } from "../extensionApi.ts";
import { AutoLinkReactorLive } from "./AutoLinkReactor.ts";
import { WorkspaceMcpToolsLive } from "./WorkspaceMcpTools.ts";

const LINKED_PROJECTS_FEATURE_ID = "upcomputer.linked-projects";

/**
 * Linked projects beyond the core state: Scratch threads link the projects
 * their agent writes into, and agents get the link tools and the
 * workspace-wide thread search on the core MCP server.
 */
export const LINKED_PROJECTS_SERVER_FEATURE = defineExperimentalServerFeature({
  id: LINKED_PROJECTS_FEATURE_ID,
  version: 1,
  layers: [
    {
      id: "auto-link",
      ownerId: LINKED_PROJECTS_FEATURE_ID,
      version: 1,
      layer: eraseExperimentalServerLayer(AutoLinkReactorLive),
    },
  ],
  mcpTools: [
    {
      id: "workspace-tools",
      ownerId: LINKED_PROJECTS_FEATURE_ID,
      version: 1,
      layer: eraseExperimentalServerLayer(WorkspaceMcpToolsLive),
    },
  ],
});
