import type { TaskAutomation } from "@upcomputer/tasks-contracts/v1";

/**
 * Tools may author automations but never arm them. Once a person has moved an
 * automation out of `draft`, the tool surface is read-only for it — otherwise
 * the review gate would be one `automation_update` call away from useless.
 *
 * Returns the refusal to show the model, or `null` when the write is allowed.
 */
export function automationToolWriteRefusal(
  automation: Pick<TaskAutomation, "id" | "status">,
): string | null {
  return automation.status === "draft"
    ? null
    : `Automation '${automation.id}' has been reviewed and is '${automation.status}'. Tools can only change automations that are still drafts; ask the user to edit it from the Automations tab.`;
}
