import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";

const state = vi.hoisted(() => ({
  sessions: new Map<
    string,
    { threadId: string; environmentId: string; projectId: string; promotedTo?: unknown }
  >(),
  retargeted: [] as Array<[string, string]>,
  resolveProject: null as ((project: { id: string }) => void) | null,
  deferProject: false,
}));

vi.mock("../composerDraftStore", () => ({
  useComposerDraftStore: {
    getState: () => ({ getDraftSession: (id: string) => state.sessions.get(id) ?? null }),
  },
}));
vi.mock("../state/entities", () => ({
  waitForProject: (ref: { projectId: string }) =>
    state.deferProject
      ? new Promise((resolve) => {
          state.resolveProject = resolve;
        })
      : Promise.resolve({ id: ref.projectId }),
}));
vi.mock("./useRetargetDraftToProject", () => ({
  retargetDraftToProject: (draftId: string, project: { id: string }) =>
    state.retargeted.push([draftId, project.id]),
}));

const {
  cancelMoveDraftIntoAddedProject,
  claimDraftMoveForAddedProject,
  disarmDraftMoveIntoAddedProject,
  moveDraftIntoNextAddedProject,
  openDraftMovedIntoProject,
  takeDraftMovingIntoProject,
} = await import("./draftIntoAddedProject");

const ENV = EnvironmentId.make("env-1");
const OTHER_ENV = EnvironmentId.make("env-2");
const ref = (id: string, environmentId = ENV) => ({
  environmentId,
  projectId: ProjectId.make(id),
});
const SCRATCH = ref("p-scratch");
const DRAFT = "draft-1" as never;
const context = (isDraftOpen: () => boolean = () => true) => ({
  serverSettings: undefined,
  projectGroupingSettings: {} as never,
  isDraftOpen,
});

beforeEach(() => {
  state.sessions = new Map([
    ["draft-1", { threadId: "thread-1", environmentId: "env-1", projectId: "p-scratch" }],
  ]);
  state.retargeted = [];
  state.deferProject = false;
  state.resolveProject = null;
  cancelMoveDraftIntoAddedProject(DRAFT);
});

describe("moving a draft into the project added from it", () => {
  it("moves only into the project the palette's add claimed", async () => {
    moveDraftIntoNextAddedProject(DRAFT, SCRATCH);
    expect(takeDraftMovingIntoProject(ref("p-new"))).toBeNull();
    claimDraftMoveForAddedProject(ref("p-new"));
    expect(takeDraftMovingIntoProject(ref("p-other"))).toBeNull();
    const move = takeDraftMovingIntoProject(ref("p-new"));
    expect(move).not.toBeNull();
    await expect(openDraftMovedIntoProject(move!, ref("p-new"), context())).resolves.toEqual({
      draftId: DRAFT,
      threadId: "thread-1",
    });
    expect(state.retargeted).toEqual([["draft-1", "p-new"]]);
    expect(takeDraftMovingIntoProject(ref("p-new"))).toBeNull();
  });

  it("is disarmed when the palette closes without an add, so a later project does not take it", () => {
    moveDraftIntoNextAddedProject(DRAFT, SCRATCH);
    disarmDraftMoveIntoAddedProject();
    claimDraftMoveForAddedProject(ref("p-added-later"));
    expect(takeDraftMovingIntoProject(ref("p-added-later"))).toBeNull();
  });

  it("survives the palette closing once claimed, as the clone flow closes it first", () => {
    moveDraftIntoNextAddedProject(DRAFT, SCRATCH);
    claimDraftMoveForAddedProject(ref("p-clone"));
    disarmDraftMoveIntoAddedProject();
    expect(takeDraftMovingIntoProject(ref("p-clone"))).not.toBeNull();
  });

  it("is not taken by the same project id in another environment", () => {
    moveDraftIntoNextAddedProject(DRAFT, SCRATCH);
    claimDraftMoveForAddedProject(ref("p-new"));
    expect(takeDraftMovingIntoProject(ref("p-new", OTHER_ENV))).toBeNull();
    expect(takeDraftMovingIntoProject(ref("added-in-other-window", OTHER_ENV))).toBeNull();
  });

  it("does nothing once cancelled, sent or given a project", () => {
    moveDraftIntoNextAddedProject(DRAFT, SCRATCH);
    claimDraftMoveForAddedProject(ref("p-new"));
    cancelMoveDraftIntoAddedProject(DRAFT);
    expect(takeDraftMovingIntoProject(ref("p-new"))).toBeNull();

    state.sessions.set("draft-1", {
      threadId: "thread-1",
      environmentId: "env-1",
      projectId: "p-scratch",
      promotedTo: { threadId: "t" },
    });
    moveDraftIntoNextAddedProject(DRAFT, SCRATCH);
    claimDraftMoveForAddedProject(ref("p-new"));
    expect(takeDraftMovingIntoProject(ref("p-new"))).toBeNull();

    state.sessions.set("draft-1", { threadId: "thread-1", environmentId: "env-1", projectId: "p" });
    moveDraftIntoNextAddedProject(DRAFT, SCRATCH);
    claimDraftMoveForAddedProject(ref("p-new"));
    expect(takeDraftMovingIntoProject(ref("p-new"))).toBeNull();
  });

  describe("while waiting for the project to reach the store", () => {
    const takeDeferred = () => {
      state.deferProject = true;
      moveDraftIntoNextAddedProject(DRAFT, SCRATCH);
      claimDraftMoveForAddedProject(ref("p-new"));
      return takeDraftMovingIntoProject(ref("p-new"))!;
    };

    it("gives up when the move is cancelled", async () => {
      const opened = openDraftMovedIntoProject(takeDeferred(), ref("p-new"), context());
      cancelMoveDraftIntoAddedProject(DRAFT);
      state.resolveProject!({ id: "p-new" });
      await expect(opened).resolves.toBeNull();
      expect(state.retargeted).toEqual([]);
    });

    it("gives up when the user switched to another thread", async () => {
      let onDraft = true;
      const opened = openDraftMovedIntoProject(
        takeDeferred(),
        ref("p-new"),
        context(() => onDraft),
      );
      onDraft = false;
      state.resolveProject!({ id: "p-new" });
      await expect(opened).resolves.toBeNull();
      expect(state.retargeted).toEqual([]);
    });

    it("gives up when the draft got another project meanwhile", async () => {
      const opened = openDraftMovedIntoProject(takeDeferred(), ref("p-new"), context());
      state.sessions.set("draft-1", {
        threadId: "thread-1",
        environmentId: "env-1",
        projectId: "p-picked",
      });
      state.resolveProject!({ id: "p-new" });
      await expect(opened).resolves.toBeNull();
      expect(state.retargeted).toEqual([]);
    });

    it("gives up when another move was armed meanwhile", async () => {
      const opened = openDraftMovedIntoProject(takeDeferred(), ref("p-new"), context());
      moveDraftIntoNextAddedProject(DRAFT, SCRATCH);
      state.resolveProject!({ id: "p-new" });
      await expect(opened).resolves.toBeNull();
      expect(state.retargeted).toEqual([]);
    });
  });
});
