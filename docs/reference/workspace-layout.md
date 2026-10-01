# Workspace layout

- `/apps/server`: Node.js WebSocket server. Wraps Codex app-server, serves the built web app, and opens the browser on start.
- `/apps/web`: React + Vite UI. Session control, conversation, and provider event rendering. Connects to the server via WebSocket.
- `/apps/desktop`: Electron shell. Spawns a desktop-scoped `t3` backend process and loads the shared web app.
- `/packages/contracts`: Shared effect/Schema schemas and TypeScript contracts for provider events, WebSocket protocol, and model/session types.
- `/packages/shared`: Shared runtime utilities consumed by both server and web. Uses explicit subpath exports (e.g. `@upcomputer/shared/git`, `@upcomputer/shared/DrainableWorker`) — no barrel index.
- `/packages/tasks-contracts`, `/packages/tasks-server`, `/packages/tasks-web`: Tasks, task agents, and automations, composed by the public product entries. See [Tasks, agents, and automations](../tasks/README.md).
- `/packages/orchestrator`, `/packages/orchestrator-web`: the Orchestrator interaction mode and its proposal components.
- `/packages/computer-use-contracts`, `/packages/computer-use-server`, `/packages/computer-use-web`: browser automation and computer use, composed by the public product entries. See [Browser and computer use](../computer-use/README.md).
