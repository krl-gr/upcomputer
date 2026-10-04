import * as NodeAssert from "node:assert/strict";
import { test } from "vite-plus/test";
import * as NodeURL from "node:url";
import type { ReactElement } from "react";

import type { ScopedTaskAgent } from "../state/index.ts";

test("agent row isolates switch activation while preserving row and name navigation", async (context) => {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root: NodeURL.fileURLToPath(new URL("../../", import.meta.url)),
    configFile: false,
    appType: "custom",
    resolve: {
      dedupe: ["react", "react-dom"],
      alias: {
        "~": NodeURL.fileURLToPath(new URL("../../../../apps/web/src", import.meta.url)),
        "@t3tools/client-runtime/environment": NodeURL.fileURLToPath(
          new URL("../../../../packages/client-runtime/src/environment/index.ts", import.meta.url),
        ),
        "@t3tools/shared": NodeURL.fileURLToPath(
          new URL("../../../../packages/shared/src", import.meta.url),
        ),
      },
    },
    server: { middlewareMode: true },
    ssr: { noExternal: ["@base-ui/react"], external: ["lucide"] },
  });
  context.onTestFinished(() => vite.close());

  const { AgentTableRow } = (await vite.ssrLoadModule(
    "/src/ui/AgentsView.tsx",
  )) as typeof import("./AgentsView.tsx");
  const agent = {
    id: "agent-1",
    environmentId: "local",
    projectId: "project-1",
    projectName: "Project",
    name: "Reviewer",
    enabled: true,
    startStatuses: ["To Do"],
    startTags: ["review"],
    startRunStatuses: [],
    config: {
      instructions: "Review changes",
      modelSelection: { instanceId: "provider-1", model: "model-1" },
      interactionMode: "default",
    },
  } as unknown as ScopedTaskAgent;
  let opens = 0;
  let toggles = 0;
  const row = AgentTableRow({
    agent,
    agentProject: null,
    editable: true,
    saving: false,
    triggerLabel: "To Do · review",
    modelLabel: "Codex · Model One",
    onOpen: () => {
      opens += 1;
    },
    onToggleEnabled: () => {
      toggles += 1;
    },
  }) as ReactElement<Record<string, unknown>>;
  const cells = row.props.children as ReactElement<Record<string, unknown>>[];
  const nameButton = cells[0]?.props.children as ReactElement<Record<string, unknown>>;
  NodeAssert.equal(cells[2]?.props.children, "Codex · Model One", "the model cell shows names");
  const switchCell = cells[4];
  const enabledSwitch = switchCell?.props.children as ReactElement<Record<string, unknown>>;
  const interactiveTarget = { closest: () => ({ role: "switch" }) };
  const plainTarget = { closest: () => null };

  (row.props.onClick as (event: unknown) => void)({ target: interactiveTarget });
  NodeAssert.equal(opens, 0, "the row guard ignores clicks from the rendered switch");

  let propagationStops = 0;
  (switchCell?.props.onPointerDown as (event: unknown) => void)({
    stopPropagation: () => {
      propagationStops += 1;
    },
  });
  (switchCell?.props.onClick as (event: unknown) => void)({
    stopPropagation: () => {
      propagationStops += 1;
    },
  });
  for (const key of [" ", "Enter"]) {
    (switchCell?.props.onKeyDown as (event: unknown) => void)({
      key,
      stopPropagation: () => {
        propagationStops += 1;
      },
    });
  }
  NodeAssert.equal(
    propagationStops,
    4,
    "pointer, click, Space, and Enter events stop at the switch cell",
  );

  (enabledSwitch.props.onCheckedChange as (checked: boolean) => void)(false);
  (enabledSwitch.props.onCheckedChange as (checked: boolean) => void)(true);
  NodeAssert.equal(toggles, 1, "one state change produces exactly one toggle");
  NodeAssert.equal(opens, 0, "mouse or keyboard-generated switch clicks do not navigate");

  (row.props.onClick as (event: unknown) => void)({ target: plainTarget });
  NodeAssert.equal(opens, 1, "clicking non-interactive row content opens details");

  let namePropagationStops = 0;
  (nameButton.props.onClick as (event: unknown) => void)({
    stopPropagation: () => {
      namePropagationStops += 1;
    },
  });
  NodeAssert.equal(namePropagationStops, 1);
  NodeAssert.equal(opens, 2, "the Agent name continues to open details exactly once");
});
