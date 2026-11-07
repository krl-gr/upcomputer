import { assert, describe, it } from "@effect/vitest";

import { setPullRequestAgentToolsRegistered } from "./pullRequestAgentTools.ts";
import { buildRuntimeInstructions } from "./runtimeInstructions.ts";

describe("buildRuntimeInstructions and the pull request agent tools", () => {
  it("tells agents to link and watch PRs only while the server registers the tools", () => {
    assert.include(buildRuntimeInstructions({ harness: "Codex" }), "<pull_request_linking>");

    setPullRequestAgentToolsRegistered(false);
    try {
      const instructions = buildRuntimeInstructions({ harness: "Codex" });
      assert.notInclude(instructions, "<pull_request_linking>");
      assert.include(instructions, "through the Codex harness");
    } finally {
      setPullRequestAgentToolsRegistered(true);
    }
  });
});
