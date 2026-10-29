import { createFileRoute } from "@tanstack/react-router";

import { BlankWorkspacePage } from "../components/BlankWorkspacePage";

// The _chat layout owns ChatView so draft promotion keeps it mounted.
export const Route = createFileRoute("/_chat/$environmentId/$threadId")({
  // UpComputer: the layout shows this leaf only while the route is moving
  // elsewhere, until the next page has loaded.
  component: BlankWorkspacePage,
});
