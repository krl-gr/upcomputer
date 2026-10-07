import * as NodeAssert from "node:assert/strict";
import { test } from "vite-plus/test";
import type { TaskAutomation } from "@t3tools/tasks-contracts/v1";

import { automationFormOf, automationUpsertOf, emptyAutomationForm } from "./automationForm.ts";

const automation = {
  id: "task-automation-1",
  projectId: "project-1",
  name: "Nightly triage",
  status: "draft",
  schedule: { cron: "30 8 * * 1,3", timezone: "Europe/Berlin" },
  template: {
    title: "Triage",
    description: "Look at new issues",
    status: "To Do",
    priority: "high",
    tags: ["triage"],
  },
  catchUpPolicy: "skip",
  skipIfOpen: false,
} as unknown as TaskAutomation;

test("an automation's form saves back as the same automation, keeping its status", () => {
  const saved = automationUpsertOf(automationFormOf(automation), automation);
  NodeAssert.ok("input" in saved);
  NodeAssert.deepEqual(saved.input, {
    id: "task-automation-1",
    projectId: "project-1",
    name: "Nightly triage",
    status: "draft",
    schedule: { cron: "30 8 * * 1,3", timezone: "Europe/Berlin" },
    template: {
      title: "Triage",
      description: "Look at new issues",
      status: "To Do",
      priority: "high",
      tags: ["triage"],
    },
    catchUpPolicy: "skip",
    skipIfOpen: false,
  });
});

test("a new automation is created disabled, and an incomplete one says what is missing", () => {
  const form = emptyAutomationForm("project-1");
  NodeAssert.deepEqual(automationUpsertOf(form, null), { error: "Automation name is required" });
  NodeAssert.deepEqual(automationUpsertOf({ ...form, name: "Daily" }, null), {
    error: "Task title is required",
  });
  NodeAssert.deepEqual(
    automationUpsertOf({ ...form, name: "Daily", title: "Check", projectId: null }, null),
    { error: "Select a project" },
  );
  NodeAssert.deepEqual(
    automationUpsertOf(
      {
        ...form,
        name: "Daily",
        title: "Check",
        schedule: { ...form.schedule, mode: "weekly", weekdays: [] },
      },
      null,
    ),
    { error: "Choose at least one day." },
  );
  const created = automationUpsertOf({ ...form, name: " Daily ", title: "Check" }, null);
  NodeAssert.ok("input" in created);
  NodeAssert.equal(created.input.status, "disabled");
  NodeAssert.equal(created.input.name, "Daily");
  NodeAssert.equal(created.input.id, undefined);
  NodeAssert.equal(created.input.schedule.cron, "0 9 * * 1,2,3,4,5");
});
