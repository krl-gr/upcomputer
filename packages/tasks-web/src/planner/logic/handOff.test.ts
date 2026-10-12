import * as NodeAssert from "node:assert/strict";
import { describe, test } from "vite-plus/test";

import { handOffAgents, handOffPatch, type HandOffAgent } from "./handOff.ts";

const agent = (id: string, overrides: Partial<HandOffAgent> = {}): HandOffAgent => ({
  id,
  name: id,
  projectId: "project-1",
  enabled: true,
  startTags: [],
  ...overrides,
});

describe("handing a person task to an agent", () => {
  test("offers the enabled agents serving the task's project, by name", () => {
    const agents = [
      agent("reviewer", { name: "Reviewer" }),
      agent("off", { enabled: false }),
      agent("elsewhere", { projectId: "project-2" }),
      agent("everywhere", { name: "Developer", projectId: null }),
    ];
    NodeAssert.deepEqual(
      handOffAgents(agents, "project-1").map(({ id }) => id),
      ["everywhere", "reviewer"],
    );
  });

  test("sets the audience, adds the agent's start tags and names it as the target", () => {
    const developer = agent("agent-dev", { startTags: ["dev", "release"] });
    NodeAssert.deepEqual(
      handOffPatch({ tags: ["release", "mine"], metadata: { source: "chat" } }, developer),
      {
        audience: "agent",
        tags: ["release", "mine", "dev"],
        metadata: { source: "chat", targetAgentId: "agent-dev" },
      },
    );
    NodeAssert.deepEqual(handOffPatch({ tags: [], metadata: null }, developer).metadata, {
      targetAgentId: "agent-dev",
    });
  });

  test("without a chosen agent only the audience changes", () => {
    NodeAssert.deepEqual(handOffPatch({ tags: ["mine"], metadata: null }, null), {
      audience: "agent",
    });
  });
});
