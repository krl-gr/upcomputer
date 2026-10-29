import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { botsInProjectScope } from "./botProjectScope.ts";

const here = EnvironmentId.make("env-here");
const there = EnvironmentId.make("env-there");
const atlas = ProjectId.make("project-atlas");
const research = ProjectId.make("project-research");
const docs = ProjectId.make("project-docs");
const bot = (name: string, projectId: ProjectId, allowedProjectIds: ReadonlyArray<ProjectId>) => ({
  name,
  projectId,
  allowedProjectIds,
});
const bots = [
  bot("developer", atlas, [atlas]),
  bot("writer", research, [research, atlas]),
  bot("helper", docs, [docs]),
];
const names = (scope: Parameters<typeof botsInProjectScope>[2], environmentId = here) =>
  botsInProjectScope(environmentId, bots, scope).map((entry) => entry.name);

describe("botsInProjectScope", () => {
  it("shows every bot for All projects", () => {
    expect(names(null)).toEqual(["developer", "writer", "helper"]);
  });

  it("shows a bot whose chat lives in a selected project", () => {
    expect(names([{ environmentId: here, projectId: research }])).toEqual(["writer"]);
  });

  it("shows a bot that may use a selected project", () => {
    expect(names([{ environmentId: here, projectId: atlas }])).toEqual(["developer", "writer"]);
  });

  it("shows no bot for No project, which leaves the scope without projects", () => {
    expect(names([])).toEqual([]);
  });

  it("matches projects only on the bot's own environment", () => {
    expect(names([{ environmentId: there, projectId: atlas }])).toEqual([]);
    expect(names([{ environmentId: there, projectId: atlas }], there)).toEqual([
      "developer",
      "writer",
    ]);
  });
});
