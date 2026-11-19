import { act, createElement, type ReactNode } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import type { ScopedTaskListItem } from "../state/taskPages.ts";

const passthrough = vi.hoisted(
  () =>
    (type: string) =>
    ({ children, render: _render, ...props }: { children?: ReactNode; render?: unknown }) =>
      createElement(type, props, children),
);

// A select exposes its value and change handler; tests find it by its trigger's label.
vi.mock("../../../../apps/web/src/components/ui/select.tsx", () => ({
  Select: ({
    children,
    value,
    onValueChange,
  }: {
    children: ReactNode;
    value: string;
    onValueChange: (value: string) => void;
  }) => createElement("div", { "data-select": true, value, onValueChange }, children),
  SelectTrigger: passthrough("button"),
  SelectValue: passthrough("span"),
  SelectPopup: passthrough("span"),
  SelectItem: passthrough("span"),
}));
vi.mock("../../../../apps/web/src/components/ui/tooltip.tsx", () => ({
  Tooltip: passthrough("span"),
  TooltipTrigger: passthrough("p"),
  TooltipPopup: passthrough("span"),
}));
vi.mock("../../../../apps/web/src/components/ProjectFavicon.tsx", () => ({
  ProjectFavicon: () => null,
}));

import { AgentTaskCard } from "./AgentTaskCard.tsx";

const task = (overrides: Partial<ScopedTaskListItem> = {}) =>
  ({
    id: "task-1",
    title: "Tidy the backlog",
    status: "To Do",
    tags: [],
    archivedAt: null,
    environmentId: "local",
    projectId: "project-1",
    projectName: "Project",
    runCounts: [],
    ...overrides,
  }) as unknown as ScopedTaskListItem;

let renderer: ReactTestRenderer;
const handlers = {
  onDragStart: vi.fn(),
  onDragEnd: vi.fn(),
  onMove: vi.fn(),
  onOpen: vi.fn(),
  onStatusChange: vi.fn(),
  onDrop: vi.fn(),
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  for (const handler of Object.values(handlers)) handler.mockClear();
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
});

async function render(item: ScopedTaskListItem) {
  await act(async () => {
    renderer = create(
      createElement(AgentTaskCard, {
        task: item,
        project: null,
        statuses: ["To Do", "Done"],
        canMutate: true,
        dragged: false,
        reorderable: true,
        ...handlers,
      }),
    );
  });
}

const card = () => renderer.root.find((node) => node.props["data-task-card"] === "");
const titleButton = () =>
  renderer.root.find((node) => node.type === "button" && node.props["aria-keyshortcuts"]);
// Event targets for the card's own handlers, which look up `closest`.
const target = (insideControl: boolean) => ({
  closest: (selector: string) =>
    insideControl && /data-prevent-drag|combobox|button/.test(selector) ? {} : null,
});

it("changes the status from the card, and only to a different status", async () => {
  await render(task());
  const select = renderer.root.find(
    (node: ReactTestInstance) =>
      node.props["data-select"] === true &&
      node.findAll((child) => child.props["aria-label"] === "Task status").length > 0,
  );
  await act(async () => select.props.onValueChange("To Do"));
  expect(handlers.onStatusChange).not.toHaveBeenCalled();
  await act(async () => select.props.onValueChange("Done"));
  expect(handlers.onStatusChange).toHaveBeenCalledWith("Done");
  expect(handlers.onOpen).not.toHaveBeenCalled();
});

it("the run numbers open the task, and show only when the task has runs", async () => {
  await render(task());
  expect(renderer.root.findAll((node) => /^Runs:/.test(node.props["aria-label"] ?? ""))).toEqual(
    [],
  );
  await render(task({ runCounts: [{ status: "failed", count: 2 }] } as never));
  const runs = renderer.root.find(
    (node) => node.type === "button" && /^Runs:/.test(node.props["aria-label"] ?? ""),
  );
  await act(async () => runs.props.onClick());
  expect(handlers.onOpen).toHaveBeenCalledTimes(1);
});

it("Alt+Arrow on the title moves the task; plain arrows do not", async () => {
  await render(task());
  const press = (key: string, altKey: boolean) =>
    titleButton().props.onKeyDown({ key, altKey, preventDefault: () => {} });
  await act(async () => press("ArrowDown", false));
  expect(handlers.onMove).not.toHaveBeenCalled();
  await act(async () => press("ArrowUp", true));
  await act(async () => press("ArrowDown", true));
  expect(handlers.onMove.mock.calls).toEqual([["up"], ["down"]]);
});

it("the card body drags and opens the task; its controls do neither", async () => {
  await render(task());
  const drag = () => {
    const event = { preventDefault: vi.fn(), dataTransfer: { effectAllowed: "" } };
    card().props.onDragStart(event);
    return event;
  };

  await act(async () => card().props.onPointerDown({ target: target(true) }));
  expect(drag().preventDefault).toHaveBeenCalled();
  expect(handlers.onDragStart).not.toHaveBeenCalled();
  await act(async () =>
    card().props.onClick({ target: target(true), currentTarget: { contains: () => true } }),
  );
  expect(handlers.onOpen).not.toHaveBeenCalled();

  await act(async () => card().props.onPointerDown({ target: target(false) }));
  const started = drag();
  expect(started.preventDefault).not.toHaveBeenCalled();
  expect(started.dataTransfer.effectAllowed).toBe("move");
  expect(handlers.onDragStart).toHaveBeenCalledTimes(1);
  await act(async () =>
    card().props.onClick({ target: target(false), currentTarget: { contains: () => true } }),
  );
  expect(handlers.onOpen).toHaveBeenCalledTimes(1);
});
