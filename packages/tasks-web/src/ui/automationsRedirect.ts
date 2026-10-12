import { storeAutomationsView } from "../planner/data/preferences.ts";
import { windowStoreFor } from "../planner/windows/windowStore.ts";

/**
 * The Automations page is gone: automations are a section of the Agents side
 * of Tasks. A link to `/automations` opens that section, and
 * `?automation=<environment>:<id>` also opens that automation's window.
 * Returns where to navigate.
 */
export function redirectFromAutomations(search: Readonly<Record<string, unknown>>) {
  const key = typeof search.automation === "string" ? search.automation : "";
  // Automation ids have no colon; an environment id might.
  const split = key.lastIndexOf(":");
  const environmentId = split > 0 ? key.slice(0, split) : null;
  const automationId = split > 0 ? key.slice(split + 1) : "";
  storeAutomationsView(environmentId);
  if (environmentId && automationId)
    windowStoreFor(environmentId, "automations-page").openAutomation(automationId);
  return { to: "/tasks", search: { view: "table" }, replace: true } as const;
}
