import { expect, it } from "@effect/vitest";
import type { Tool } from "effect/ai";

import { WorkspaceToolkit } from "../linkedProjects/WorkspaceMcpTools.ts";
import { advertisedJsonSchema } from "./advertisedJsonSchema.ts";
import { enumsGeminiRejects } from "./geminiToolSchema.testkit.ts";
import { AttachmentToolkit } from "./toolkits/attachment/tools.ts";
import { DeviceToolkit } from "./toolkits/device/tools.ts";
import { EnvironmentToolkit } from "./toolkits/environment/tools.ts";
import { HtmlToolkit } from "./toolkits/html/tools.ts";
import { MessageToolkit } from "./toolkits/message/tools.ts";
import { OrchestratorToolkit } from "./toolkits/orchestrator/tools.ts";
import { PreviewToolkit } from "./toolkits/preview/tools.ts";
import { PreviewControlsToolkit } from "./toolkits/previewControls/tools.ts";
import { ProjectToolkit } from "./toolkits/project/tools.ts";
import { PullRequestsToolkit } from "./toolkits/pullRequests/tools.ts";
import { ThemeToolkit } from "./toolkits/theme/tools.ts";
import { ThreadToolkit } from "./toolkits/thread/tools.ts";
import { ToolSearchToolkit } from "./toolkits/toolSearch/tools.ts";
import { WorktreeToolkit } from "./toolkits/worktree/tools.ts";

// The toolkits /mcp advertises through advertisedJsonSchema. The task, bot and computer use
// tools advertise their own schemas; their packages' MCP tests check those.
const toolkits = [
  AttachmentToolkit,
  DeviceToolkit,
  EnvironmentToolkit,
  HtmlToolkit,
  MessageToolkit,
  OrchestratorToolkit,
  PreviewToolkit,
  PreviewControlsToolkit,
  ProjectToolkit,
  PullRequestsToolkit,
  ThemeToolkit,
  ThreadToolkit,
  ToolSearchToolkit,
  WorktreeToolkit,
  WorkspaceToolkit,
];

it("every compacted tool schema holds only enums Gemini accepts", () => {
  const tools = toolkits.flatMap((toolkit) =>
    Object.values(toolkit.tools as Record<string, Tool.Any>),
  );
  expect(tools.map((tool) => tool.name)).toContain("t3_theme_set");
  expect(
    tools.flatMap((tool) => enumsGeminiRejects(tool.name, advertisedJsonSchema(tool))),
  ).toEqual([]);
});
