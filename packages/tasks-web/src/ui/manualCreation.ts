/**
 * Experiment: agent tasks and agents are created through agents, so the header
 * "+" that opens their manual create forms is hidden. Tasks show it again since
 * person tasks arrived, and the table's create form makes agent tasks.
 * Automations are created in the Workers side's Automations section.
 */
export const SHOW_MANUAL_CREATE_ACTIONS = {
  tasks: true,
  agents: false,
} as const;
