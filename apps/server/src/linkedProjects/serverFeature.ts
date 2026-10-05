import { defineExperimentalServerFeature, eraseExperimentalServerLayer } from "../extensionApi.ts";
import { AutoLinkReactorLive } from "./AutoLinkReactor.ts";

const LINKED_PROJECTS_FEATURE_ID = "upcomputer.linked-projects";

/** Linked projects beyond the core state: Scratch threads link the projects their agent writes into. */
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
});
