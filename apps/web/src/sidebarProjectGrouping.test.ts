import { EnvironmentId, ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import { deriveProjectVisualIdentityKey } from "@t3tools/shared/projectFavicon";
import { describe, expect, it } from "vite-plus/test";

import { buildSidebarProjectSnapshots } from "./sidebarProjectGrouping";
import type { Project } from "./types";

const environmentId = EnvironmentId.make("env-primary");
const repositoryIdentity = {
  canonicalKey: "github.com/pingdotgg/t3code",
  displayName: "pingdotgg/t3code",
  name: "t3code",
  rootPath: "/repo/t3code",
  locator: {
    source: "git-remote" as const,
    remoteName: "origin",
    remoteUrl: "https://github.com/pingdotgg/t3code.git",
  },
};

function makeProject(id: string, title: string, workspaceRoot: string): Project {
  return {
    id: ProjectId.make(id),
    environmentId,
    title,
    workspaceRoot,
    repositoryIdentity,
    defaultModelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5-codex",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    scripts: [],
  };
}

describe("sidebar project grouping", () => {
  it("uses an explicit order-independent identity for a repository group", () => {
    const web = makeProject("project-web", "web", "/repo/t3code/apps/web");
    const api = makeProject("project-api", "api", "/repo/t3code/apps/api");
    const settings = {
      sidebarProjectGroupingMode: "repository" as const,
      sidebarProjectGroupingOverrides: {},
    };
    const build = (projects: Project[]) =>
      buildSidebarProjectSnapshots({
        projects,
        settings,
        primaryEnvironmentId: environmentId,
        resolveEnvironmentLabel: () => null,
      });

    const webFirst = build([web, api]);
    const apiFirst = build([api, web]);

    expect(webFirst).toHaveLength(1);
    expect(apiFirst).toHaveLength(1);
    expect(webFirst[0]?.projectKey).toBe(repositoryIdentity.canonicalKey);
    expect(webFirst[0]?.visualIdentityKey).toBe(repositoryIdentity.canonicalKey);
    expect(apiFirst[0]?.visualIdentityKey).toBe(webFirst[0]?.visualIdentityKey);
    expect(webFirst[0]?.displayName).toBe("pingdotgg/t3code");

    // Active-project surfaces keep the concrete subproject identity instead of
    // inheriting whichever member happened to represent the grouped sidebar row.
    const webIdentity = deriveProjectVisualIdentityKey({
      cwd: web.workspaceRoot,
      repositoryIdentity: web.repositoryIdentity,
    });
    const apiIdentity = deriveProjectVisualIdentityKey({
      cwd: api.workspaceRoot,
      repositoryIdentity: api.repositoryIdentity,
    });
    expect(webIdentity).toBe(`${repositoryIdentity.canonicalKey}::apps/web`);
    expect(apiIdentity).toBe(`${repositoryIdentity.canonicalKey}::apps/api`);
    expect(webIdentity).not.toBe(apiIdentity);
  });
});
