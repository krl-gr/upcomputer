import { lazy, Suspense } from "react";

// The pure host module: the product entry imports this file while the
// connection runtime is still initializing, so the UI loads on first render.
import {
  defineExperimentalWebFeature,
  type ExperimentalWebThreadAccessoryProps,
} from "../product/WebFeature";

const LazyThreadLinkedProjects = lazy(() => import("./ThreadLinkedProjects"));

/** The open chat's linked projects after its title, with a menu to link and unlink. */
function ChatHeaderLinkedProjects(props: ExperimentalWebThreadAccessoryProps) {
  return (
    <Suspense fallback={null}>
      <LazyThreadLinkedProjects {...props} />
    </Suspense>
  );
}

/** Linked projects (UpComputer): link and unlink projects from the open thread. */
export const LINKED_PROJECTS_WEB_FEATURE = defineExperimentalWebFeature({
  id: "upcomputer.linked-projects.web",
  version: 1,
  chatHeaderAccessory: ChatHeaderLinkedProjects,
});
