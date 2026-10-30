import * as NodeAssert from "node:assert/strict";
import * as Schema from "effect/Schema";
import { test } from "vite-plus/test";

import { getLocalStorageItem } from "../../../../apps/web/src/hooks/useLocalStorage.ts";
import {
  PLANNER_ENVIRONMENT_KEY,
  TABLE_SECTION_KEY,
  TASKS_VIEW_KEY,
} from "../planner/data/preferences.ts";
import { windowStoreFor } from "../planner/windows/windowStore.ts";
import { redirectFromAutomations } from "./automationsRedirect.ts";

const stored = (key: string) => getLocalStorageItem(key, Schema.NullOr(Schema.String));

test("/automations opens the Workers side on its Automations section", () => {
  NodeAssert.deepEqual(redirectFromAutomations({}), {
    to: "/tasks",
    search: { view: "table" },
    replace: true,
  });
  NodeAssert.equal(stored(TASKS_VIEW_KEY), "table");
  NodeAssert.equal(stored(TABLE_SECTION_KEY), "automations");
});

test("an automation link also opens that automation's window in its environment", () => {
  redirectFromAutomations({ automation: "remote:env:task-automation-7" });
  NodeAssert.equal(stored(PLANNER_ENVIRONMENT_KEY), "remote:env");
  const windows = windowStoreFor("remote:env", "automations-page").getSnapshot();
  NodeAssert.deepEqual(
    windows.map((window) => [window.kind, window.kind === "automation" && window.automationId]),
    [["automation", "task-automation-7"]],
  );
});
