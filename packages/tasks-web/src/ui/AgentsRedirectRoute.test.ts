import * as NodeAssert from "node:assert/strict";
import { test } from "vite-plus/test";

import { TASKS_WEB_FEATURE } from "../feature.tsx";
import { redirectFromAgents } from "./AgentsRedirectRoute.tsx";

test("/agents opens the Workers page with the same worker selected", () => {
  NodeAssert.deepEqual(redirectFromAgents({ agent: "env:task-agent-1" }), {
    to: "/$",
    params: { _splat: "workers" },
    search: { agent: "env:task-agent-1" },
    replace: true,
  });
  const paths = (TASKS_WEB_FEATURE.routes ?? []).map((route) => route.path);
  NodeAssert.ok(paths.includes("/workers") && paths.includes("/agents"));
});
