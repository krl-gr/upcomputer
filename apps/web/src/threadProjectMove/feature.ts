// The pure host module: the product entry imports this file while the connection runtime is
// still initializing, so the menu, which reads web state, loads once this module graph is done.
// The thread menu asks synchronously; until then it has no move entry.
import { defineExperimentalWebFeature } from "../product/WebFeature";

let menu: typeof import("./threadProjectMoveMenu") | undefined;
void import("./threadProjectMoveMenu").then((module) => {
  menu = module;
});

/** Move a thread to another project on its computer (UpComputer). */
export const THREAD_PROJECT_MOVE_WEB_FEATURE = defineExperimentalWebFeature({
  id: "upcomputer.thread-project-move.web",
  version: 1,
  threadActions: (thread) => menu?.threadProjectMoveActions(thread) ?? [],
});
