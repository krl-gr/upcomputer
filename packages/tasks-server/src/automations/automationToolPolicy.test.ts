import * as NodeAssert from "node:assert/strict";
import { test } from "vite-plus/test";

import { TASK_TOOL_SPECS } from "../tools/TaskToolDefinitions.ts";
import { automationToolWriteRefusal } from "./automationToolPolicy.ts";

function toolSpec(name: string) {
  const spec = TASK_TOOL_SPECS.find((candidate) => candidate.name === name);
  NodeAssert.ok(spec, `expected a '${name}' tool`);
  return spec;
}

function properties(name: string): Record<string, unknown> {
  const schema = toolSpec(name).inputSchema as {
    readonly properties?: Record<string, unknown>;
    readonly additionalProperties?: boolean;
  };
  NodeAssert.equal(schema.additionalProperties, false, `${name} must reject unknown fields`);
  return schema.properties ?? {};
}

test("no automation tool lets a model set the review status", () => {
  for (const name of ["automation_create", "automation_update"]) {
    const fields = Object.keys(properties(name));
    NodeAssert.equal(
      fields.includes("status"),
      false,
      `${name} must not expose a status field; activation is a human decision`,
    );
    NodeAssert.equal(fields.includes("enabled"), false, `${name} must not expose an enabled field`);
  }
});

test("automation_create does not let a model choose the automation id", () => {
  // The handler writes a new row; accepting a caller-supplied id would let an
  // agent name an existing reviewed automation and overwrite it into a draft.
  NodeAssert.equal(
    Object.keys(properties("automation_create")).includes("id"),
    false,
    "automation_create must always mint its own id",
  );
});

test("automation_create requires a schedule and a task template", () => {
  const spec = toolSpec("automation_create").inputSchema as {
    readonly required?: ReadonlyArray<string>;
  };
  NodeAssert.deepEqual([...(spec.required ?? [])].sort(), ["cron", "name", "template"]);
});

test("tools may rewrite drafts but not automations a person has reviewed", () => {
  NodeAssert.equal(automationToolWriteRefusal({ id: "a-1", status: "draft" } as never), null);

  for (const status of ["enabled", "disabled"] as const) {
    const refusal = automationToolWriteRefusal({ id: "a-1", status } as never);
    NodeAssert.ok(refusal, `a '${status}' automation must be read-only from tools`);
    NodeAssert.match(refusal, /drafts/);
  }
});
