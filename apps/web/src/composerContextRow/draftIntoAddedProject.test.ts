import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";

const state = vi.hoisted(() => ({
  sessions: new Map<string, { threadId: string; promotedTo?: unknown }>(),
  retargeted: [] as Array<[string, string]>,
}));

vi.mock("../composerDraftStore", () => ({
  useComposerDraftStore: {
    getState: () => ({ getDraftSession: (id: string) => state.sessions.get(id) ?? null }),
  },
}));
vi.mock("../state/entities", () => ({
  waitForProject: (ref: { projectId: string }) => Promise.resolve({ id: ref.projectId }),
}));
vi.mock("./useRetargetDraftToProject", () => ({
  retargetDraftToProject: (draftId: string, project: { id: string }) =>
    state.retargeted.push([draftId, project.id]),
}));

const {
  cancelMoveDraftIntoAddedProject,
  moveDraftIntoNextAddedProject,
  openDraftMovedIntoProject,
  takeDraftMovingIntoProject,
} = await import("./draftIntoAddedProject");

const ENV = EnvironmentId.make("env-1");
const ref = (id: string) => ({ environmentId: ENV, projectId: ProjectId.make(id) });
const KNOWN = [{ environmentId: ENV, id: ProjectId.make("p-scratch") }];
const DRAFT = "draft-1" as never;

beforeEach(() => {
  state.sessions = new Map([["draft-1", { threadId: "thread-1" }]]);
  state.retargeted = [];
  cancelMoveDraftIntoAddedProject(DRAFT);
});

describe("moving a draft into the project added from it", () => {
  it("takes the draft once, for a project added since, not a known one", () => {
    moveDraftIntoNextAddedProject(DRAFT, KNOWN);
    expect(takeDraftMovingIntoProject(ref("p-scratch"))).toBeNull();
    expect(takeDraftMovingIntoProject(ref("p-new"))).toBe(DRAFT);
    expect(takeDraftMovingIntoProject(ref("p-other"))).toBeNull();
  });

  it("does nothing once cancelled or after the draft was sent", () => {
    moveDraftIntoNextAddedProject(DRAFT, KNOWN);
    cancelMoveDraftIntoAddedProject(DRAFT);
    expect(takeDraftMovingIntoProject(ref("p-new"))).toBeNull();

    state.sessions.set("draft-1", { threadId: "thread-1", promotedTo: { threadId: "t" } });
    moveDraftIntoNextAddedProject(DRAFT, KNOWN);
    expect(takeDraftMovingIntoProject(ref("p-new"))).toBeNull();
  });

  it("retargets the draft and opens it unless it is already open", async () => {
    const open = vi.fn(() => Promise.resolve());
    const context = { serverSettings: undefined, projectGroupingSettings: {} as never, open };
    await expect(
      openDraftMovedIntoProject(DRAFT, ref("p-new"), { ...context, isOpen: () => false }),
    ).resolves.toEqual({ draftId: DRAFT, threadId: "thread-1" });
    expect(state.retargeted).toEqual([["draft-1", "p-new"]]);
    expect(open).toHaveBeenCalledOnce();

    await openDraftMovedIntoProject(DRAFT, ref("p-new"), { ...context, isOpen: () => true });
    expect(open).toHaveBeenCalledOnce();
  });
});
