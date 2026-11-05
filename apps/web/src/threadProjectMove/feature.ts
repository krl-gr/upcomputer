import { createElement, lazy, Suspense } from "react";

import { defineExperimentalWebFeature } from "../product/WebFeature";

// The thread menu asks synchronously, so its module loads with the app shell's coordinators,
// never at module load: this file is imported while the web state graph is still initializing.
// Until then the menu simply has no move entry.
let menu: typeof import("./threadProjectMoveMenu") | undefined;
const LazyMenuLoader = lazy(() =>
  import("./threadProjectMoveMenu").then((module) => {
    menu = module;
    return { default: () => null };
  }),
);

function ThreadProjectMoveMenuLoader() {
  return createElement(Suspense, { fallback: null }, createElement(LazyMenuLoader));
}

/** Move a thread to another project on its computer (UpComputer). */
export const THREAD_PROJECT_MOVE_WEB_FEATURE = defineExperimentalWebFeature({
  id: "upcomputer.thread-project-move.web",
  version: 1,
  threadActions: (thread) => menu?.threadProjectMoveActions(thread) ?? [],
  coordinator: ThreadProjectMoveMenuLoader,
});
