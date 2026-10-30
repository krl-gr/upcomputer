import { DndContext } from "@dnd-kit/core";
import type { TaskScheduleEntry } from "@t3tools/tasks-contracts/v1";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import "~/index.css";

import {
  CalendarEntryCard,
  PlannerContext,
  QueueEntryCard,
  usePlannerDnd,
  type EntryCardHandlers,
} from "@t3tools/tasks-web/planner";
import { render } from "../../test/render";

const entry = {
  id: "entry-1",
  taskId: "task-1",
  date: "2026-10-30",
  position: "a0",
  startTime: "09:00",
  durationMinutes: 60,
  status: "open",
  createdAt: "2026-10-30T00:00:00.000Z",
  updatedAt: "2026-10-30T00:00:00.000Z",
} as TaskScheduleEntry;

// The cards read only the preferences and the projects.
const planner = {
  preferences: { cardStyle: "classic", slotHeight: 20 },
  projectById: new Map(),
} as never;

// The planner's own sensors; with no droppables, a drag plans nothing.
function Planner(props: { readonly children: ReactNode; readonly onDragEnd?: () => void }) {
  const dnd = usePlannerDnd({
    store: {} as never,
    tasks: new Map(),
    days: new Map([[entry.date, [entry]]]),
    listIds: null,
    automations: null,
    onReorderAutomation: () => {},
    allowBottomDrop: false,
    selection: { active: false, ids: new Set() },
    onBlockMoved: () => {},
    slotHeight: 20,
  });
  return (
    <PlannerContext value={planner}>
      <DndContext
        sensors={dnd.sensors}
        {...dnd.handlers}
        onDragEnd={(event) => {
          dnd.handlers.onDragEnd(event);
          props.onDragEnd?.();
        }}
      >
        <div style={{ position: "relative", width: 240, height: 200 }}>{props.children}</div>
      </DndContext>
    </PlannerContext>
  );
}

function handlers(): EntryCardHandlers {
  return {
    onToggleStatus: vi.fn(),
    onMenu: vi.fn(),
    onOpen: vi.fn(),
    onToggleSelected: vi.fn(),
  };
}

const card = () => document.querySelector<HTMLElement>(`[data-entry-id="${entry.id}"]`)!;

describe("planner entry cards", () => {
  it("open on a click or Enter, not after a drag or from their buttons", async () => {
    const queue = handlers();
    const onDragEnd = vi.fn();
    await using screen = await render(
      <Planner onDragEnd={onDragEnd}>
        <QueueEntryCard
          entry={entry}
          task={undefined}
          selectMode={false}
          selected={false}
          handlers={queue}
        />
      </Planner>,
    );
    const element = screen.getByText("Loading…");

    await userEvent.click(screen.getByRole("button", { name: "Mark as done" }));
    expect(queue.onToggleStatus).toHaveBeenCalledOnce();
    expect(queue.onOpen).not.toHaveBeenCalled();

    await userEvent.click(element);
    expect(queue.onOpen).toHaveBeenCalledExactlyOnceWith(entry);

    card().focus();
    await userEvent.keyboard("{Enter}");
    expect(queue.onOpen).toHaveBeenCalledTimes(2);

    // Last: dnd-kit swallows clicks for a moment after a drag ends.
    await userEvent.dragAndDrop(element, element, {
      sourcePosition: { x: 4, y: 4 },
      targetPosition: { x: 60, y: 4 },
    });
    expect(onDragEnd).toHaveBeenCalledOnce();
    expect(queue.onOpen).toHaveBeenCalledTimes(2);
  });

  it("do not open in select mode or after a resize", async () => {
    const calendar = handlers();
    const onResize = vi.fn();
    const position = { top: 0, height: 80, leftPct: 0, widthPct: 100, laneIndex: 0, laneCount: 1 };
    await using screen = await render(
      <Planner>
        <CalendarEntryCard
          entry={entry}
          task={undefined}
          position={position}
          duration={60}
          selectMode={false}
          selected={false}
          handlers={calendar}
          onResize={onResize}
        />
      </Planner>,
    );

    const handle = screen.getByRole("separator", { name: "Drag to change the duration" });
    await userEvent.dragAndDrop(handle, handle, {
      sourcePosition: { x: 20, y: 1 },
      targetPosition: { x: 20, y: 40 },
      force: true,
    });
    expect(onResize).toHaveBeenCalledOnce();
    expect(calendar.onOpen).not.toHaveBeenCalled();

    await screen.rerender(
      <Planner>
        <CalendarEntryCard
          entry={entry}
          task={undefined}
          position={position}
          duration={60}
          selectMode
          selected={false}
          handlers={calendar}
          onResize={onResize}
        />
      </Planner>,
    );
    // An unselected card is aria-disabled for dragging, which Playwright treats as not clickable.
    await userEvent.click(screen.getByText("Loading…"), { force: true });
    expect(calendar.onOpen).not.toHaveBeenCalled();
  });
});
