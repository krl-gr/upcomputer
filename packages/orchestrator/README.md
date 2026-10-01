# Orchestrator extension

Interaction mode for drafting structured agent-and-task orchestration
proposals.

This package owns only Orchestrator-specific behavior:

- the `orchestrator` mode registration and its per-provider behavior;
- the non-mutating proposal instructions;
- the final-output parser for proposals (the proposal schema lives in
  `@upcomputer/tasks-contracts/v1/proposals`);
- serializable UI metadata consumed by `@upcomputer/orchestrator-web`;
- the server feature and product-manifest entry composed by the public build.

It does not contain provider adapters, the task system, application
entrypoints, or React integration. Core services consume this package through
build-time extension contribution APIs. Task creation and proposal application
belong to `@upcomputer/tasks-server`.
