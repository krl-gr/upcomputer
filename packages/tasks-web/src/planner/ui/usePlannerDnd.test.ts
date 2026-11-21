import { act, createElement, useEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import type {
  CollisionDetection,
  DragEndEvent,
  DragMoveEvent,
  DragStartEvent,
} from "@dnd-kit/core";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  TaskId,
  TaskScheduleEntryId,
  type TaskKind,
  type TaskScheduleEntry,
} from "@t3tools/tasks-contracts/v1";
import { Option } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  composerTaskDropTargetProps,
  decodeTaskDragPayload,
  endComposerTaskDrag,
} from "../../../../../apps/web/src/components/chat/composerTaskDrag.ts";
import type { PlannerTask } from "../data/pendingOps.ts";
import type { PlannerStore } from "../data/plannerStore.ts";
import {
  makePlannerCollisionDetection,
  resolvePlannerComposerTasks,
  usePlannerDnd,
} from "./usePlannerDnd.ts";

const ENV_ID = EnvironmentId.make("env-local");
const PROJECT_ID = ProjectId.make("proj-1");

const makeTask = (id: string, title: string, kind: TaskKind = "task"): PlannerTask =>
  ({
    id: TaskId.make(id),
    title,
    kind,
    projectId: PROJECT_ID,
  }) as unknown as PlannerTask;

const makeEntry = (id: string, taskId: string, date: string): TaskScheduleEntry =>
  ({
    id: TaskScheduleEntryId.make(id),
    taskId: TaskId.make(taskId),
    date,
  }) as unknown as TaskScheduleEntry;

const context = { environmentId: ENV_ID };

class FakeElement extends EventTarget {
  readonly attributes: Record<string, string>;
  readonly parentElement: FakeElement | null;
  readonly overflowX: string;
  readonly overflowY: string;
  readonly rect: {
    left: number;
    right: number;
    top: number;
    bottom: number;
    width: number;
    height: number;
  };

  constructor(options?: {
    attributes?: Record<string, string>;
    parent?: FakeElement | null;
    overflowX?: string;
    overflowY?: string;
    rect?: { left: number; right: number; top: number; bottom: number };
  }) {
    super();
    this.attributes = options?.attributes ?? {};
    this.parentElement = options?.parent ?? null;
    this.overflowX = options?.overflowX ?? "visible";
    this.overflowY = options?.overflowY ?? "visible";
    const r = options?.rect ?? { left: 0, right: 0, top: 0, bottom: 0 };
    this.rect = { ...r, width: r.right - r.left, height: r.bottom - r.top };
  }

  getBoundingClientRect() {
    return this.rect;
  }

  private matchesSelector(selector: string): boolean {
    const match = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
    if (!match || !match[1]) return false;
    const [, name, expected] = match;
    if (!(name in this.attributes)) return false;
    return expected === undefined || this.attributes[name] === expected;
  }

  closest(selector: string): FakeElement | null {
    for (
      let current: FakeElement | null = this;
      current !== null;
      current = current.parentElement
    ) {
      if (current.matchesSelector(selector)) return current;
    }
    return null;
  }
}

describe("resolvePlannerComposerTasks", () => {
  const tasks = new Map<string, PlannerTask>([
    ["t1", makeTask("t1", "Plan release", "task")],
    ["r1", makeTask("r1", "Daily review", "routine")],
  ]);
  const days = new Map<string, readonly TaskScheduleEntry[]>([
    ["2026-11-21", [makeEntry("e1", "t1", "2026-11-21"), makeEntry("e2", "r1", "2026-11-21")]],
    ["2026-11-22", [makeEntry("e3", "t1", "2026-11-22")]],
  ]);

  it("resolves a planner task or routine", () => {
    expect(
      resolvePlannerComposerTasks({ kind: "task", taskId: "t1" }, context, tasks, days),
    ).toEqual([
      {
        environmentId: ENV_ID,
        taskId: "t1",
        title: "Plan release",
        kind: "task",
      },
    ]);
    expect(
      resolvePlannerComposerTasks({ kind: "task", taskId: "r1" }, context, tasks, days),
    ).toEqual([
      {
        environmentId: ENV_ID,
        taskId: "r1",
        title: "Daily review",
        kind: "routine",
      },
    ]);
  });

  it("resolves scheduled entries and deduplicates repeated tasks in a multi-entry drag", () => {
    expect(
      resolvePlannerComposerTasks(
        { kind: "entry", entryId: "e1", date: "2026-11-21", ids: ["e1", "e3", "e2"] },
        context,
        tasks,
        days,
      ).map((item) => ({ taskId: item.taskId, kind: item.kind })),
    ).toEqual([
      { taskId: "t1", kind: "task" },
      { taskId: "r1", kind: "routine" },
    ]);
  });

  it("never produces composer payloads for automations", () => {
    expect(
      resolvePlannerComposerTasks(
        { kind: "automation", automationId: "auto-1" },
        context,
        tasks,
        days,
      ),
    ).toEqual([]);
  });
});

describe("makePlannerCollisionDetection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const makeArgs = (
    point: { x: number; y: number },
    columnNode: FakeElement | null,
    columnRect: {
      left: number;
      right: number;
      top: number;
      bottom: number;
      width: number;
      height: number;
    },
  ): Parameters<CollisionDetection>[0] =>
    ({
      active: { id: "task-list-t1" },
      collisionRect: columnRect,
      droppableRects: new Map([["column-2026-11-21", columnRect]]),
      droppableContainers: [
        {
          id: "column-2026-11-21",
          disabled: false,
          node: { current: columnNode },
          data: { current: { type: "queue-column", date: "2026-11-21" } },
        },
      ],
      pointerCoordinates: point,
    }) as unknown as Parameters<CollisionDetection>[0];

  it("ignores scrolled-off planner droppables when the pointer is outside planner root bounds", () => {
    const scrolledColumnRect = {
      left: 100,
      right: 900,
      top: 0,
      bottom: 800,
      width: 800,
      height: 800,
    };
    const detect = makePlannerCollisionDetection(() => ({
      node: null,
      rect: { left: 800, right: 1440, top: 0, bottom: 900 },
    }));

    expect(detect(makeArgs({ x: 400, y: 700 }, null, scrolledColumnRect))).toEqual([]);
    expect(detect(makeArgs({ x: 850, y: 700 }, null, scrolledColumnRect))).toHaveLength(1);
  });

  it("filters collisions clipped by a scroll ancestor inside the planner", () => {
    const plannerRoot = new FakeElement({ rect: { left: 800, right: 1440, top: 0, bottom: 900 } });
    const scroller = new FakeElement({
      parent: plannerRoot,
      overflowX: "auto",
      rect: { left: 950, right: 1400, top: 0, bottom: 900 },
    });
    const column = new FakeElement({ parent: scroller });

    vi.stubGlobal("getComputedStyle", (el: FakeElement) => ({
      overflowX: el.overflowX,
      overflowY: el.overflowY,
    }));

    const scrolledColumnRect = {
      left: 820,
      right: 1050,
      top: 0,
      bottom: 800,
      width: 230,
      height: 800,
    };
    const detect = makePlannerCollisionDetection(() => ({
      node: plannerRoot as unknown as HTMLElement,
      rect: plannerRoot.getBoundingClientRect(),
    }));

    // Inside planner root (x=850), but left of the week scroller's visible edge (x=950).
    expect(detect(makeArgs({ x: 850, y: 200 }, column, scrolledColumnRect))).toEqual([]);
    // Inside both planner root and scroller (x=980).
    expect(detect(makeArgs({ x: 980, y: 200 }, column, scrolledColumnRect))).toHaveLength(1);
  });
});

describe("usePlannerDnd composer bridge lifecycle", () => {
  let renderer: ReactTestRenderer | undefined;
  const latestHook: { current: ReturnType<typeof usePlannerDnd> | null } = { current: null };

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    latestHook.current = null;
  });

  afterEach(async () => {
    endComposerTaskDrag();
    if (renderer) {
      await act(async () => renderer?.unmount());
      renderer = undefined;
    }
    vi.unstubAllGlobals();
  });

  const mountHook = async () => {
    const tasks = new Map<string, PlannerTask>([["t1", makeTask("t1", "Plan release", "task")]]);
    const store = {
      reorder: vi.fn(),
      addEntries: vi.fn(),
      moveEntries: vi.fn(),
    } as unknown as PlannerStore;
    function Harness() {
      const value = usePlannerDnd({
        store,
        tasks,
        days: new Map(),
        listIds: ["t1"],
        allowBottomDrop: true,
        automations: null,
        onReorderAutomation: () => undefined,
        selection: { active: false, ids: new Set() },
        onBlockMoved: () => undefined,
        slotHeight: 24,
        composerDrag: context,
      });
      useEffect(() => {
        latestHook.current = value;
      });
      return null;
    }
    await act(async () => {
      renderer = create(createElement(Harness));
    });
  };

  const setupComposerTarget = () => {
    const fakeWindow = new EventTarget();
    const form = new FakeElement({ attributes: { ...composerTaskDropTargetProps() } });
    const overLog: boolean[] = [];
    const drops: string[][] = [];
    form.addEventListener("t3-composer-task-drag-over", (event) => {
      overLog.push((event as CustomEvent<boolean>).detail);
    });
    form.addEventListener("t3-composer-task-drop", (event) => {
      drops.push([...(event as CustomEvent<readonly string[]>).detail]);
    });
    vi.stubGlobal("Element", FakeElement);
    vi.stubGlobal("window", fakeWindow);
    vi.stubGlobal("document", {
      elementsFromPoint: (x: number) => (x < 600 ? [form] : []),
      querySelector: () => null,
    });
    return { fakeWindow, overLog, drops };
  };

  const activeTask = {
    id: "task-list-t1",
    data: { current: { type: "task", taskId: "t1" } },
  };

  it("ignores mouse movement during KeyboardSensor drags and never drops on composer", async () => {
    const { fakeWindow, overLog, drops } = setupComposerTarget();
    await mountHook();

    await act(async () => {
      latestHook.current!.handlers.onDragStart({
        active: activeTask,
        activatorEvent: new Event("keydown"),
      } as unknown as DragStartEvent);
    });

    const moveEvent = Object.assign(new Event("pointermove"), { clientX: 200, clientY: 500 });
    fakeWindow.dispatchEvent(moveEvent);

    await act(async () => {
      latestHook.current!.handlers.onDragMove({
        active: activeTask,
        over: null,
        delta: { x: -500, y: 0 },
      } as unknown as DragMoveEvent);
      latestHook.current!.handlers.onDragEnd({
        active: activeTask,
        over: null,
        delta: { x: -500, y: 0 },
      } as unknown as DragEndEvent);
    });

    expect(overLog).toEqual([]);
    expect(drops).toEqual([]);
  });

  it("highlights and drops on pointer drag, and clears highlight on cancel", async () => {
    const { overLog, drops } = setupComposerTarget();
    await mountHook();

    const pointerDown = Object.assign(new Event("mousedown"), { clientX: 900, clientY: 300 });
    await act(async () => {
      latestHook.current!.handlers.onDragStart({
        active: activeTask,
        activatorEvent: pointerDown,
      } as unknown as DragStartEvent);
    });
    await act(async () => {
      latestHook.current!.handlers.onDragMove({
        active: activeTask,
        over: null,
        delta: { x: -600, y: 200 },
      } as unknown as DragMoveEvent);
    });
    expect(overLog).toEqual([true]);

    await act(async () => {
      latestHook.current!.handlers.onDragCancel();
    });
    expect(overLog).toEqual([true, false]);
    expect(drops).toEqual([]);

    await act(async () => {
      latestHook.current!.handlers.onDragStart({
        active: activeTask,
        activatorEvent: pointerDown,
      } as unknown as DragStartEvent);
    });
    await act(async () => {
      latestHook.current!.handlers.onDragEnd({
        active: activeTask,
        over: null,
        delta: { x: -600, y: 200 },
      } as unknown as DragEndEvent);
    });

    expect(drops).toHaveLength(1);
    expect(Option.getOrNull(decodeTaskDragPayload(drops[0]?.[0]))).toEqual({
      environmentId: ENV_ID,
      taskId: "t1",
      title: "Plan release",
      kind: "task",
    });
  });
});
