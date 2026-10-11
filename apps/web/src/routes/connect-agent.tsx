import { createFileRoute, redirect } from "@tanstack/react-router";

import { ConnectAgentSurface } from "../components/auth/ConnectAgentSurface";
import { isProductFeatureShown } from "../product/productFlags";

export const Route = createFileRoute("/connect-agent")({
  beforeLoad: () => {
    if (!isProductFeatureShown("mcpOAuth")) throw redirect({ to: "/", replace: true });
  },
  component: ConnectAgentSurface,
});
