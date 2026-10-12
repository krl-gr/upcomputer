import * as NodeAssert from "node:assert/strict";
import { describe, test } from "vite-plus/test";

import { handOffAgents, handOffPatch, type HandOffAgent } from "./handOff.ts";

const agent = (id: string, overrides: Partial<HandOffAgent> = {}): HandOffAgent => ({
  id,
  name: id,
  projectId: "project-1",
  enabled: true,
  startStatuses: ["To Do"],
  startTags: [],
  startRunStatuses: [],
  ...overrides,
});

describe("handing a person task to an agent", () => {
  test("offers the enabled agents serving the task's project that start on task state, by name", () => {
    const agents = [
      agent("reviewer", { name: "Reviewer" }),
      agent("off", { enabled: false }),
      agent("elsewhere", { projectId: "project-2" }),
      agent("everywhere", { name: "Developer", projectId: null }),
      agent("fixer", { startRunStatuses: ["failed"] }),
    ];
    NodeAssert.deepEqual(
      handOffAgents(agents, "project-1").map(({ id }) => id),
      ["everywhere", "reviewer"],
    );
  });

  test("sets the audience, adds the agent's start tags and names it as the target", () => {
    const developer = agent("agent-dev", { startTags: ["dev", "release"] });
    NodeAssert.deepEqual(
      handOffPatch(
        { status: "To Do", tags: ["release", "mine"], metadata: { source: "chat" } },
        developer,
      ),
      {
        audience: "agent",
        tags: ["release", "mine", "dev"],
        metadata: { source: "chat", targetAgentId: "agent-dev" },
      },
    );
    NodeAssert.deepEqual(handOffPatch({ status: "To Do", tags: [], metadata: null }, developer), {
      audience: "agent",
      tags: ["dev", "release"],
      metadata: { targetAgentId: "agent-dev" },
    });
  });

  test("without a chosen agent only the audience changes", () => {
    NodeAssert.deepEqual(handOffPatch({ status: "To Do", tags: ["mine"], metadata: null }, null), {
      audience: "agent",
    });
  });

  test("moves the task to the agent's first start status unless it is in one", () => {
    const reviewer = agent("reviewer", { startStatuses: ["Needs Review", "Review"] });
    NodeAssert.deepEqual(handOffPatch({ status: "To Do", tags: [], metadata: null }, reviewer), {
      audience: "agent",
      status: "Needs Review",
      tags: [],
      metadata: { targetAgentId: "reviewer" },
    });
    NodeAssert.equal(
      "status" in handOffPatch({ status: "Review", tags: [], metadata: null }, reviewer),
      false,
    );
    const anyStatus = agent("any", { startStatuses: [] });
    NodeAssert.equal(
      "status" in handOffPatch({ status: "Done", tags: [], metadata: null }, anyStatus),
      false,
    );
  });
});
