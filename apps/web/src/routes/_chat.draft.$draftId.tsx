import { createFileRoute } from "@tanstack/react-router";

import { BlankWorkspacePage } from "../components/BlankWorkspacePage";

// The view lives in the `_chat` layout (see ThreadRouteView) so a draft's
// promotion to `/$environmentId/$threadId` keeps the same ChatView mounted.
export const Route = createFileRoute("/_chat/draft/$draftId")({
  // UpComputer: the layout shows this leaf only while the route is moving
  // elsewhere, until the next page has loaded.
  component: BlankWorkspacePage,
});
