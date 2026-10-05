import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { filterSidebarV2VisibleThreads } from "../components/Sidebar.logic";
import { makeThreadFixture } from "../test-fixtures";
import { projectLinksByKey } from "./projectScope";

const environmentId = EnvironmentId.make("environment-links");
const home = ProjectId.make("project-home");
const docs = ProjectId.make("project-docs");
const infra = ProjectId.make("project-infra");
const scope = (projectId: ProjectId) => new Set([`${environmentId}:${projectId}`]);

describe("linked projects in the sidebar project scope", () => {
  const linkedThread = {
    ...makeThreadFixture({ id: ThreadId.make("thread-linked"), environmentId, projectId: home }),
    linkedProjectIds: [docs],
  };
  const plainThread = makeThreadFixture({
    id: ThreadId.make("thread-plain"),
    environmentId,
    projectId: home,
  });
  const infraThread = makeThreadFixture({
    id: ThreadId.make("thread-infra"),
    environmentId,
    projectId: infra,
  });
  const threads = [linkedThread, plainThread, infraThread];
  const ids = (projectId: ProjectId, links?: ReadonlyMap<string, ReadonlyArray<string>>) =>
    filterSidebarV2VisibleThreads(threads, scope(projectId), links).map((thread) => thread.id);

  it("shows a linked thread under its own project and under the project it links", () => {
    expect(ids(home)).toEqual([linkedThread.id, plainThread.id]);
    expect(ids(docs)).toEqual([linkedThread.id]);
    expect(ids(infra)).toEqual([infraThread.id]);
  });

  it("shows every thread of a project under the projects that project links", () => {
    const links = projectLinksByKey([
      { environmentId, id: infra, linkedProjectIds: [docs] },
      { environmentId, id: home, linkedProjectIds: [] },
    ]);
    expect(ids(docs, links)).toEqual([linkedThread.id, infraThread.id]);
    // Project links are one-directional.
    expect(ids(infra, links)).toEqual([infraThread.id]);
  });

  it("matches links only within the thread's environment", () => {
    const otherEnvironment = new Set([`${EnvironmentId.make("environment-other")}:${docs}`]);
    expect(filterSidebarV2VisibleThreads(threads, otherEnvironment)).toEqual([]);
  });
});
