import { assert, it } from "@effect/vitest";

import { currentFreeAgentSetupBlock, isFreeAgentRun, setFreeAgentSetup } from "./freeAgentSetup.ts";

it("gives the setup steps only to OpenCode on a free Zen model while it is the only agent", () => {
  try {
    setFreeAgentSetup({ active: true, freeAgentInstanceIds: ["opencode"] });
    assert.include(currentFreeAgentSetupBlock("opencode/glm-5.3-flash-free"), "<free_agent_setup>");
    // The user's own OpenCode: paid Zen or their own keys.
    assert.isUndefined(currentFreeAgentSetupBlock("opencode/claude-sonnet-5-5"));
    assert.isUndefined(currentFreeAgentSetupBlock("anthropic/claude-sonnet-5-5-free"));
    assert.isTrue(
      isFreeAgentRun({
        providerInstanceId: "opencode",
        modelSelection: { model: "opencode/glm-5.3-flash-free" },
      }),
    );
    assert.isFalse(
      isFreeAgentRun({ providerInstanceId: "opencode", modelSelection: { model: "zai/glm-5.3" } }),
    );
    assert.isFalse(
      isFreeAgentRun({
        providerInstanceId: "claudeAgent",
        modelSelection: { model: "opencode/glm-5.3-flash-free" },
      }),
    );

    setFreeAgentSetup({ active: false, freeAgentInstanceIds: ["opencode"] });
    assert.isUndefined(currentFreeAgentSetupBlock("opencode/glm-5.3-flash-free"));
  } finally {
    setFreeAgentSetup({ active: false, freeAgentInstanceIds: [] });
  }
});
