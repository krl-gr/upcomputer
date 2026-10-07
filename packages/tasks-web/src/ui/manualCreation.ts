/**
 * Experiment: agent tasks and agents are created through agents, so the header
 * "+" that opens their manual create forms is hidden. Tasks show it again since
 * person tasks arrived: people write their own tasks. Automations are created
 * in the planner (Routines, Agents).
 */
export const SHOW_MANUAL_CREATE_ACTIONS = {
  tasks: true,
  agents: false,
} as const;
