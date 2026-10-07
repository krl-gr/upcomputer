import * as NodeAssert from "node:assert/strict";
import * as Schema from "effect/Schema";
import { test } from "vite-plus/test";

import { getLocalStorageItem } from "../../../../apps/web/src/hooks/useLocalStorage.ts";
import {
  PLANNER_AUDIENCE_KEY,
  PLANNER_ENVIRONMENT_KEY,
  PLANNER_KIND_KEY,
  TASKS_VIEW_KEY,
} from "../planner/data/preferences.ts";
import { windowStoreFor } from "../planner/windows/windowStore.ts";
import { redirectFromAutomations } from "./automationsRedirect.ts";

const stored = (key: string) => getLocalStorageItem(key, Schema.NullOr(Schema.String));

test("/automations opens the planner on Routines × Agents", () => {
  NodeAssert.deepEqual(redirectFromAutomations({}), {
    to: "/tasks",
    search: { view: "planner" },
    replace: true,
  });
  NodeAssert.equal(stored(TASKS_VIEW_KEY), "planner");
  NodeAssert.equal(stored(PLANNER_KIND_KEY), "routine");
  NodeAssert.equal(stored(PLANNER_AUDIENCE_KEY), "agent");
});

test("an automation link also opens that automation's window in its environment", () => {
  redirectFromAutomations({ automation: "remote:env:task-automation-7" });
  NodeAssert.equal(stored(PLANNER_ENVIRONMENT_KEY), "remote:env");
  const windows = windowStoreFor("remote:env").getSnapshot();
  NodeAssert.deepEqual(
    windows.map((window) => [window.kind, window.kind === "automation" && window.automationId]),
    [["automation", "task-automation-7"]],
  );
});
