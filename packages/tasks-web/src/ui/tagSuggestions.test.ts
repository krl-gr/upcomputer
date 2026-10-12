import * as NodeAssert from "node:assert/strict";
import { test } from "vite-plus/test";

import { tagSuggestions } from "./tagSuggestions.ts";

const agents = [
  { name: "Developer", enabled: true, projectId: "project-1", startTags: ["dev", "release"] },
  { name: "Reviewer", enabled: true, projectId: null, startTags: ["review", "release"] },
  { name: "Paused", enabled: false, projectId: "project-1", startTags: ["paused"] },
  { name: "Elsewhere", enabled: true, projectId: "project-2", startTags: ["other"] },
];

const suggest = (query: string, taskTags: readonly string[] = []) =>
  tagSuggestions({
    query,
    taskTags,
    projectId: "project-1",
    agents,
    knownTags: ["bug", "dev", "ui"],
  }).map(({ tag, agents }) => (agents.length > 0 ? `${tag} (${agents.join(", ")})` : tag));

test("offers the project's agents' trigger tags with their names, then tags in use", () => {
  NodeAssert.deepEqual(suggest(""), [
    "dev (Developer)",
    "release (Developer, Reviewer)",
    "review (Reviewer)",
    "bug",
    "ui",
  ]);
});

test("leaves out the task's tags and matches a tag or an agent's name", () => {
  NodeAssert.deepEqual(suggest("", ["dev", "bug"]), [
    "release (Developer, Reviewer)",
    "review (Reviewer)",
    "ui",
  ]);
  NodeAssert.deepEqual(suggest("review"), ["release (Developer, Reviewer)", "review (Reviewer)"]);
  NodeAssert.deepEqual(suggest("U"), ["bug", "ui"]);
});
