/**
 * Experiment: agent tasks, agents and automations are created through agents,
 * so the header "+" that opens their manual create forms is hidden. Tasks show
 * it again since person tasks arrived: people write their own tasks.
 */
export const SHOW_MANUAL_CREATE_ACTIONS = {
  tasks: true,
  agents: false,
  automations: false,
} as const;
