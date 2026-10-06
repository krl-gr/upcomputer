import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import { test } from "vite-plus/test";
import type { ReactElement } from "react";

import { DetailColumn } from "./DetailSidebar.tsx";

// Any background utility, in any state: `bg-x`, `hover:bg-x`, `dark:!bg-x`.
const BACKGROUND_CLASS = /(?:^|[\s:!])bg-/;

test("the detail column has no background of its own and uses the regular tokens", () => {
  const column = DetailColumn({ children: null }) as ReactElement<{ className: string }>;
  const className = column.props.className;

  NodeAssert.equal(column.type, "aside");
  NodeAssert.doesNotMatch(className, BACKGROUND_CLASS);
  NodeAssert.doesNotMatch(className, /sidebar/);
  NodeAssert.match(className, /\bborder-l border-border\b/);
  NodeAssert.match(className, /\btext-foreground\b/);
});

test("task, agent and automation views render both detail columns through DetailColumn", () => {
  for (const view of ["TasksView.tsx", "AgentsView.tsx", "AutomationsView.tsx"]) {
    const source = NodeFS.readFileSync(new URL(`./${view}`, import.meta.url), "utf8");
    // The existing item and the create form.
    NodeAssert.equal(source.match(/<DetailColumn>/g)?.length, 2, view);
    NodeAssert.doesNotMatch(source, /<aside/, view);
    NodeAssert.doesNotMatch(source, /\b(?:bg|text)-sidebar/, view);
  }
});
