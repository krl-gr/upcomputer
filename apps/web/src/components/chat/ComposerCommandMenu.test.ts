import { EnvironmentId, ProjectId } from "@upcomputer/contracts";
import { describe, expect, it } from "vite-plus/test";

import { type ComposerCommandItem, groupCommandItems } from "./ComposerCommandMenu";

const fileItem: ComposerCommandItem = {
  id: "path:file:src/app.ts",
  type: "path",
  path: "src/app.ts",
  pathKind: "file",
  label: "app.ts",
  description: "src",
};

const projectItem: ComposerCommandItem = {
  id: "project:env:web",
  type: "project",
  project: {
    id: ProjectId.make("web"),
    environmentId: EnvironmentId.make("env"),
    title: "Web",
    workspaceRoot: "/repo/web",
  },
  label: "Web",
  description: "Link to this chat",
};

describe("groupCommandItems for @ mentions", () => {
  it("keeps plain file results in one unlabeled group", () => {
    expect(groupCommandItems([fileItem], "path", true)).toEqual([
      { id: "default", label: null, items: [fileItem] },
    ]);
  });

  it("puts matching projects in a Projects group before files", () => {
    expect(groupCommandItems([projectItem, fileItem], "path", true)).toEqual([
      { id: "projects", label: "Projects", items: [projectItem] },
      { id: "files", label: "Files", items: [fileItem] },
    ]);
  });

  it("shows only the Projects group when no file matches", () => {
    expect(groupCommandItems([projectItem], "path", true)).toEqual([
      { id: "projects", label: "Projects", items: [projectItem] },
    ]);
  });
});
