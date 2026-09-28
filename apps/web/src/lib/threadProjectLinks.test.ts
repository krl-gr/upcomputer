import { EnvironmentId, ProjectId } from "@upcomputer/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  addPendingProjectLink,
  formatProjectMentionText,
  matchProjectMentions,
  removePendingProjectLink,
  resolvePendingProjectLinks,
  resolveProjectChoiceEffect,
  searchProjectsByTitle,
  selectLinkableProjects,
} from "./threadProjectLinks";

const LOCAL = EnvironmentId.make("env-local");
const REMOTE = EnvironmentId.make("env-remote");

function project(id: string, title: string, environmentId = LOCAL) {
  return { id: ProjectId.make(id), environmentId, title };
}

const SCRATCH = project("scratch", "No project");
const WEB = project("web", "Web App");
const API = project("api", "api-server");
const DOCS = project("docs", "Docs");
const REMOTE_WEB = project("remote-web", "Web App", REMOTE);

describe("selectLinkableProjects", () => {
  it("keeps same-environment projects, dropping scratch and excluded ids", () => {
    expect(
      selectLinkableProjects({
        projects: [SCRATCH, WEB, API, DOCS, REMOTE_WEB],
        environmentId: LOCAL,
        isScratchProject: (candidate) => candidate.id === SCRATCH.id,
        excludedProjectIds: [WEB.id, DOCS.id],
      }),
    ).toEqual([API]);
  });
});

describe("searchProjectsByTitle", () => {
  const projects = [DOCS, project("webby", "My webby tool"), API, WEB, project("x", "Framework")];

  it("keeps every project, in order, for an empty query", () => {
    expect(searchProjectsByTitle(projects, "  ")).toEqual(projects);
  });

  it("ranks exact, prefix, word-start, then substring matches", () => {
    expect(searchProjectsByTitle(projects, "web").map((entry) => entry.title)).toEqual([
      "Web App",
      "My webby tool",
    ]);
    expect(searchProjectsByTitle(projects, "SERVER").map((entry) => entry.title)).toEqual([
      "api-server",
    ]);
    expect(searchProjectsByTitle(projects, "work").map((entry) => entry.title)).toEqual([
      "Framework",
    ]);
    expect(searchProjectsByTitle(projects, "docs").map((entry) => entry.title)).toEqual(["Docs"]);
  });

  it("returns nothing when no title matches", () => {
    expect(searchProjectsByTitle(projects, "zzz")).toEqual([]);
  });
});

describe("matchProjectMentions", () => {
  it("caps the number of project suggestions", () => {
    const many = Array.from({ length: 8 }, (_, index) => project(`p${index}`, `Project ${index}`));
    expect(matchProjectMentions(many, "project")).toHaveLength(5);
    expect(matchProjectMentions(many, "project", 2)).toEqual(many.slice(0, 2));
  });
});

describe("formatProjectMentionText", () => {
  it("inserts a plain mention followed by a space", () => {
    expect(formatProjectMentionText("api-server")).toBe("@api-server ");
  });

  it("quotes titles that would otherwise split into several tokens", () => {
    expect(formatProjectMentionText(" Web App ")).toBe('@"Web App" ');
    expect(formatProjectMentionText('Say "hi"')).toBe('@"Say \\"hi\\"" ');
  });
});

describe("resolveProjectChoiceEffect", () => {
  it("links on started threads, whatever their project", () => {
    expect(resolveProjectChoiceEffect({ isServerThread: true, isScratchProject: true })).toBe(
      "link",
    );
    expect(resolveProjectChoiceEffect({ isServerThread: true, isScratchProject: false })).toBe(
      "link",
    );
  });

  it("moves an unsent chat without a project into the chosen project", () => {
    expect(resolveProjectChoiceEffect({ isServerThread: false, isScratchProject: true })).toBe(
      "retarget",
    );
  });

  it("remembers the choice on other drafts until the first send", () => {
    expect(resolveProjectChoiceEffect({ isServerThread: false, isScratchProject: false })).toBe(
      "pending-link",
    );
  });
});

describe("pending project links", () => {
  const webLink = { environmentId: LOCAL, projectId: WEB.id };
  const apiLink = { environmentId: LOCAL, projectId: API.id };

  it("adds each project once and removes by identity", () => {
    const once = addPendingProjectLink([], webLink);
    const twice = addPendingProjectLink(once, { ...webLink });
    expect(twice).toBe(once);
    const both = addPendingProjectLink(twice, apiLink);
    expect(both).toEqual([webLink, apiLink]);
    expect(removePendingProjectLink(both, { ...webLink })).toEqual([apiLink]);
    expect(removePendingProjectLink(both, { environmentId: REMOTE, projectId: WEB.id })).toBe(both);
  });

  it("links only what still applies to the created thread", () => {
    expect(
      resolvePendingProjectLinks({
        pending: [
          webLink,
          apiLink,
          apiLink,
          { environmentId: LOCAL, projectId: DOCS.id },
          { environmentId: REMOTE, projectId: REMOTE_WEB.id },
          { environmentId: LOCAL, projectId: ProjectId.make("deleted") },
        ],
        environmentId: LOCAL,
        // The draft moved into Web App after the mention: never link to self.
        threadProjectId: WEB.id,
        linkedProjectIds: [DOCS.id],
        availableProjectIds: new Set([WEB.id, API.id, DOCS.id]),
      }),
    ).toEqual([API.id]);
  });
});
