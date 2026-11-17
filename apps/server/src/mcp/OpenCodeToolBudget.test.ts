import { describe, expect, it } from "@effect/vitest";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import { MCP_TOOL_EXPOSURE_HEADER } from "@t3tools/provider-core/server/mcpSession";
import { UPCOMPUTER_PRODUCT_FLAGS } from "@t3tools/shared/productFlags";
import * as Effect from "effect/Effect";

import { COMPUTER_USE_TOOLS } from "../../../../packages/computer-use-server/src/computerUse/ComputerUseToolDefinitions.ts";
import {
  openCodePermissionRules,
  openCodeT3McpHeaders,
} from "../../../../packages/provider-opencode/src/server/adapter.ts";
import { TASK_TOOL_SPECS } from "../../../../packages/tasks-server/src/tools/TaskToolDefinitions.ts";
import { WorkspaceToolkit } from "../linkedProjects/WorkspaceMcpTools.ts";
import * as McpToolExposure from "./McpToolExposure.ts";
import { AttachmentToolkit } from "./toolkits/attachment/tools.ts";
import { DeviceToolkit } from "./toolkits/device/tools.ts";
import { EnvironmentToolkit } from "./toolkits/environment/tools.ts";
import { HtmlToolkit } from "./toolkits/html/tools.ts";
import { MessageToolkit } from "./toolkits/message/tools.ts";
import { OrchestratorToolkit } from "./toolkits/orchestrator/tools.ts";
import { PreviewToolkit } from "./toolkits/preview/tools.ts";
import { PreviewControlsToolkit } from "./toolkits/previewControls/tools.ts";
import { ProjectToolkit } from "./toolkits/project/tools.ts";
import { ThemeToolkit } from "./toolkits/theme/tools.ts";
import { PullRequestsToolkit } from "./toolkits/pullRequests/tools.ts";
import { ThreadToolkit } from "./toolkits/thread/tools.ts";
import { ToolSearchToolkit } from "./toolkits/toolSearch/tools.ts";
import { WorktreeToolkit } from "./toolkits/worktree/tools.ts";

/** The limit OpenAI-compatible APIs put on one request's tools. */
const API_TOOL_LIMIT = 128;
/** OpenCode 1.19 sends about 15 tools of its own; leave room for more. */
const OPENCODE_OWN_TOOLS_ALLOWANCE = 24;

const listed = (toolkit: {
  readonly tools: Record<
    string,
    { readonly name: string; readonly description?: string | undefined }
  >;
}) =>
  Object.values(toolkit.tools).map((tool) => ({
    name: tool.name,
    description: tool.description ?? "",
  }));

/**
 * Every tool `/mcp` serves in the Up.computer product: McpHttpServer.layer plus
 * its features, where a feature's tool replaces a core tool of the same name.
 */
const upComputerT3Tools = [
  ...new Map(
    [
      ...listed(PreviewToolkit),
      ...listed(OrchestratorToolkit),
      ...listed(ThreadToolkit),
      ...listed(AttachmentToolkit),
      ...listed(ProjectToolkit),
      ...listed(EnvironmentToolkit),
      ...listed(PreviewControlsToolkit),
      ...listed(WorktreeToolkit),
      ...(UPCOMPUTER_PRODUCT_FLAGS.pullRequestAgentTools ? listed(PullRequestsToolkit) : []),
      ...(UPCOMPUTER_PRODUCT_FLAGS.devices ? listed(DeviceToolkit) : []),
      ...listed(HtmlToolkit),
      ...listed(ThemeToolkit),
      ...listed(MessageToolkit),
      ...listed(WorkspaceToolkit),
      ...TASK_TOOL_SPECS.map(({ name, description }) => ({ name, description })),
      ...COMPUTER_USE_TOOLS.map(({ name, description }) => ({ name, description })),
      ...listed(ToolSearchToolkit),
    ].map((tool) => [tool.name, tool] as const),
  ).values(),
];

const SESSION = "opencode-session";

/** What the deferred listing in McpHttpServer shows the session, by OpenCode's tool name. */
const sentToModel = (exposure: McpToolExposure.McpToolExposure["Service"]) =>
  upComputerT3Tools
    .filter((tool) => exposure.isListed(SESSION, tool.name))
    .map((tool) => `t3-code_${tool.name}`);

const exposureFor = () =>
  McpToolExposure.make(
    () => upComputerT3Tools,
    () => Effect.void,
  );

describe("OpenCode session tools", () => {
  it("ask the T3 MCP server for deferred listing and deny none of its tools", () => {
    expect(openCodeT3McpHeaders("Bearer token")).toEqual({
      Authorization: "Bearer token",
      [MCP_TOOL_EXPOSURE_HEADER]: "deferred",
    });
    const rules = openCodePermissionRules(
      ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
        runtimeMode: "full-access",
        interactionMode: "default",
        cwd: null,
      }),
    );
    expect(rules.filter((rule) => rule.permission.startsWith("t3-code"))).toEqual([]);
  });

  it.effect("stay within the API's 128-tool limit and load computer use and the browser", () =>
    Effect.gen(function* () {
      const exposure = exposureFor();
      // Listing everything would reach the limit.
      expect(upComputerT3Tools.length + OPENCODE_OWN_TOOLS_ALLOWANCE).toBeGreaterThanOrEqual(
        API_TOOL_LIMIT,
      );
      expect(sentToModel(exposure)).toContain("t3-code_tool_search");
      expect(sentToModel(exposure)).not.toContain("t3-code_computer_screenshot");

      const computerUse = yield* exposure.search(SESSION, "computer");
      expect(computerUse.map((tool) => tool.name).sort()).toEqual(
        COMPUTER_USE_TOOLS.map((tool) => tool.name).sort(),
      );
      // "use" also matches send_to_user, so the loosest query still finds the screenshot tool.
      expect((yield* exposure.search(SESSION, "computer use")).map((tool) => tool.name)).toContain(
        "computer_screenshot",
      );
      const browser = yield* exposure.search(SESSION, "browser preview");
      expect(browser.map((tool) => tool.name)).toContain("preview_open");
      yield* exposure.search(SESSION, "task_update t3_thread_launch");

      const sent = sentToModel(exposure);
      for (const tool of [
        "computer_screenshot",
        "computer_click",
        "preview_open",
        "task_update",
        "t3_thread_launch",
        "delegate_task",
      ]) {
        expect(sent).toContain(`t3-code_${tool}`);
      }
      expect(sent.length + OPENCODE_OWN_TOOLS_ALLOWANCE).toBeLessThanOrEqual(API_TOOL_LIMIT);
    }),
  );
});
