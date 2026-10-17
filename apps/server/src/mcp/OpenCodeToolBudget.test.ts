import { describe, expect, it } from "@effect/vitest";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import { UPCOMPUTER_PRODUCT_FLAGS } from "@t3tools/shared/productFlags";

import { COMPUTER_USE_TOOL_NAMES } from "../../../../packages/computer-use-server/src/computerUse/ComputerUseToolDefinitions.ts";
import { openCodePermissionRules } from "../../../../packages/provider-opencode/src/server/adapter.ts";
import { TASK_TOOL_SPECS } from "../../../../packages/tasks-server/src/tools/TaskToolDefinitions.ts";
import { WorkspaceToolkit } from "../linkedProjects/WorkspaceMcpTools.ts";
import { AttachmentToolkit } from "./toolkits/attachment/tools.ts";
import { DeviceToolkit } from "./toolkits/device/tools.ts";
import { EnvironmentToolkit } from "./toolkits/environment/tools.ts";
import { HtmlToolkit } from "./toolkits/html/tools.ts";
import { OrchestratorToolkit } from "./toolkits/orchestrator/tools.ts";
import { PreviewToolkit } from "./toolkits/preview/tools.ts";
import { PreviewControlsToolkit } from "./toolkits/previewControls/tools.ts";
import { ProjectToolkit } from "./toolkits/project/tools.ts";
import { PullRequestsToolkit } from "./toolkits/pullRequests/tools.ts";
import { ThreadToolkit } from "./toolkits/thread/tools.ts";
import { WorktreeToolkit } from "./toolkits/worktree/tools.ts";

/** The limit OpenAI-compatible APIs put on one request's tools. */
const API_TOOL_LIMIT = 128;
/** OpenCode 1.19 sends about 15 tools of its own; leave room for more. */
const OPENCODE_OWN_TOOLS_ALLOWANCE = 24;

const names = (toolkit: { readonly tools: Record<string, unknown> }) => Object.keys(toolkit.tools);

/**
 * Every tool `/mcp` serves in the Up.computer product: McpHttpServer.layer plus
 * its features, where a feature's tool replaces a core tool of the same name.
 */
const upComputerT3Tools = new Set([
  ...names(PreviewToolkit),
  ...names(OrchestratorToolkit),
  ...names(ThreadToolkit),
  ...names(AttachmentToolkit),
  ...names(ProjectToolkit),
  ...names(EnvironmentToolkit),
  ...names(PreviewControlsToolkit),
  ...names(WorktreeToolkit),
  ...(UPCOMPUTER_PRODUCT_FLAGS.pullRequests ? names(PullRequestsToolkit) : []),
  ...(UPCOMPUTER_PRODUCT_FLAGS.devices ? names(DeviceToolkit) : []),
  ...names(HtmlToolkit),
  ...names(WorkspaceToolkit),
  ...TASK_TOOL_SPECS.map((spec) => spec.name),
  ...COMPUTER_USE_TOOL_NAMES,
]);

// OpenCode's Wildcard.match and Permission.disabled: a tool is left out when the
// last rule whose permission matches its name denies it for every pattern.
const wildcard = (pattern: string) =>
  new RegExp(
    `^${pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replaceAll("*", ".*")
      .replaceAll("?", ".")}$`,
    "s",
  );

function toolsOpenCodeSends(tools: ReadonlySet<string>) {
  const rules = openCodePermissionRules(
    ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
      runtimeMode: "full-access",
      interactionMode: "default",
      cwd: null,
    }),
  );
  return [...tools]
    .map((tool) => `t3-code_${tool}`)
    .filter((tool) => {
      const rule = rules.findLast((entry) => wildcard(entry.permission).test(tool));
      return !(rule?.pattern === "*" && rule.action === "deny");
    });
}

describe("OpenCode session tools", () => {
  it("stay within the API's 128-tool limit with OpenCode's own", () => {
    const sent = toolsOpenCodeSends(upComputerT3Tools);

    expect(upComputerT3Tools.size + OPENCODE_OWN_TOOLS_ALLOWANCE).toBeGreaterThan(API_TOOL_LIMIT);
    expect(sent.length + OPENCODE_OWN_TOOLS_ALLOWANCE).toBeLessThanOrEqual(API_TOOL_LIMIT);
  });

  it("keep the tools Up.computer's instructions name", () => {
    const sent = toolsOpenCodeSends(upComputerT3Tools);

    for (const tool of ["task_get", "task_update", "t3_thread_launch", "html_render"]) {
      expect(sent).toContain(`t3-code_${tool}`);
    }
    for (const tool of ["preview_snapshot", "t3_preview_list", "computer_click"]) {
      expect(sent).not.toContain(`t3-code_${tool}`);
    }
  });
});
