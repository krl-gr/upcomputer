import {
  createContext,
  useContext,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type Modifier,
} from "@dnd-kit/core";

import { Collapsible, CollapsiblePanel } from "../../../../apps/web/src/components/ui/collapsible.tsx";
import { cn } from "../../../../apps/web/src/lib/utils.ts";
import {
  SIDEBAR_DIM_TEXT,
  SIDEBAR_SECTION_GAP,
  SIDEBAR_SECTION_HEADER_GAP,
} from "../../../../apps/web/src/sidebarMetrics/sidebarMetrics.ts";
import { SidebarSectionHeader } from "../../../../apps/web/src/sidebarProjects/SidebarSectionHeader.tsx";
import { movedGroupOrder, type TaskStatusGroup } from "./taskStatusGroups.ts";

interface GroupDragState {
  readonly keys: readonly string[];
  readonly activeKey: string | null;
  readonly reorderable: boolean;
  readonly move: (key: string, direction: "up" | "down") => void;
}

const GroupDragContext = createContext<GroupDragState>({
  keys: [],
  activeKey: null,
  reorderable: false,
  move: () => undefined,
});

const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });

/** Where the dragged group would land: the gap's index in the group order, and its line on screen. */
interface GroupDrop {
  readonly index: number;
  readonly top: number;
  readonly left: number;
  readonly width: number;
}

/** The list's own scroller: a drop line outside it would draw over the page header. */
function scrollerBounds(node: HTMLElement | null): { readonly top: number; readonly bottom: number } {
  for (let parent = node?.parentElement; parent; parent = parent.parentElement) {
    const overflow = getComputedStyle(parent).overflowY;
    if (overflow === "auto" || overflow === "scroll") {
      const rect = parent.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    }
  }
  return { top: 0, bottom: window.innerHeight };
}

/**
 * The groups of the agents' task list and the drag that reorders them. Only
 * the header moves with the pointer: the group stays in place, dimmed, and a
 * line marks the gap it will land in, so a long group drags as easily as a short one.
 */
export function TaskStatusGroupsProvider(props: {
  readonly groups: readonly TaskStatusGroup<unknown>[];
  readonly counts: Readonly<Record<string, number>>;
  /** The shown groups in their new order, and the group that moved. */
  readonly onReorder: (keys: readonly string[], moved: string) => void;
  /** The dragged header's side insets, to match the layout it is lifted from. */
  readonly overlayClassName?: string;
  /** How far the drop line stays in from the group's sides: the cards' own inset from the list. */
  readonly lineInset?: number;
  readonly children: ReactNode;
}) {
  const keys = useMemo(() => props.groups.map((group) => group.key), [props.groups]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [drop, setDrop] = useState<GroupDrop | null>(null);
  const pointerY = useRef(0);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );
  // Groups differ in height: the one under the pointer, or the nearest above or below it.
  const collisionDetection = useMemo<CollisionDetection>(
    () =>
      ({ droppableContainers, droppableRects, pointerCoordinates, collisionRect }) => {
        const y = pointerCoordinates?.y ?? collisionRect.top + collisionRect.height / 2;
        pointerY.current = y;
        let nearest: (typeof droppableContainers)[number] | null = null;
        let nearestDistance = Number.POSITIVE_INFINITY;
        for (const container of droppableContainers) {
          const rect = droppableRects.get(container.id);
          if (!rect) continue;
          const distance = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
          if (distance < nearestDistance) {
            nearest = container;
            nearestDistance = distance;
          }
        }
        return nearest
          ? [{ id: nearest.id, data: { droppableContainer: nearest, value: nearestDistance } }]
          : [];
      },
    [],
  );
  const reorder = (key: string, index: number) => {
    const next = movedGroupOrder(keys, key, index);
    if (next !== keys) props.onReorder(next, key);
  };
  const endDrag = () => {
    setActiveKey(null);
    setDrop(null);
  };
  const state = useMemo<GroupDragState>(
    () => ({
      keys,
      activeKey,
      reorderable: keys.length > 1,
      move: (key, direction) => {
        const from = keys.indexOf(key);
        const next = movedGroupOrder(keys, key, direction === "up" ? from - 1 : from + 2);
        if (next !== keys) props.onReorder(next, key);
      },
    }),
    [activeKey, keys, props],
  );
  const activeGroup = props.groups.find((group) => group.key === activeKey);
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      modifiers={[verticalOnly]}
      onDragStart={(event) => setActiveKey(String(event.active.id))}
      onDragMove={(event) => {
        const over = event.over;
        const node = event.collisions?.[0]?.data?.droppableContainer?.node?.current ?? null;
        if (!over) {
          setDrop(null);
          return;
        }
        const after = pointerY.current > over.rect.top + over.rect.height / 2;
        const index = keys.indexOf(String(over.id)) + (after ? 1 : 0);
        const from = keys.indexOf(String(event.active.id));
        const top = after ? over.rect.top + over.rect.height : over.rect.top;
        const bounds = scrollerBounds(node);
        // Dropping a group beside itself changes nothing, so no line shows there.
        setDrop(
          index === from || index === from + 1 || top < bounds.top || top > bounds.bottom
            ? null
            : { index, top, left: over.rect.left, width: over.rect.width },
        );
      }}
      onDragEnd={(event) => {
        if (drop) reorder(String(event.active.id), drop.index);
        endDrag();
      }}
      onDragCancel={endDrag}
    >
      <GroupDragContext value={state}>{props.children}</GroupDragContext>
      <DragOverlay dropAnimation={null}>
        {activeGroup ? (
          <div
            className={cn(
              "cursor-grabbing rounded-lg border border-border bg-popover shadow-lg",
              props.overlayClassName,
            )}
            data-task-status-group-overlay=""
          >
            <SidebarSectionHeader
              title={activeGroup.title}
              open={activeGroup.open}
              onToggle={() => undefined}
              action={<GroupCount count={props.counts[activeGroup.key] ?? 0} />}
            />
          </div>
        ) : null}
      </DragOverlay>
      {/* Above the lifted header, which would otherwise cover the gap it is about to drop into. */}
      {drop ? (
        <div
          aria-hidden
          data-group-drop-line=""
          className="pointer-events-none fixed z-[1000] h-0.5 rounded-full bg-primary"
          style={{
            top: drop.top - 1,
            left: drop.left + (props.lineInset ?? 0),
            width: drop.width - 2 * (props.lineInset ?? 0),
          }}
        />
      ) : null}
    </DndContext>
  );
}

/** The one addition to the sidebar's header: how many tasks the group holds, in the title's grey. */
function GroupCount(props: { readonly count: number }) {
  return (
    <span className={cn("shrink-0 text-sm tabular-nums", SIDEBAR_DIM_TEXT)} data-group-count="">
      {props.count}
    </span>
  );
}

function useGroupDrag(key: string) {
  const drag = useContext(GroupDragContext);
  return { ...drag, dragging: drag.activeKey === key };
}

/**
 * A group's header: the sidebar's section header itself, with the count in
 * its action slot. The whole header drags the group; Alt+Arrow moves it too,
 * as it moves a task.
 */
function GroupHeader(props: {
  readonly group: TaskStatusGroup<unknown>;
  readonly count: number;
  readonly onOpenChange: (open: boolean) => void;
  readonly className?: string;
}) {
  const { group } = props;
  const drag = useContext(GroupDragContext);
  const { setNodeRef, listeners } = useDraggable({ id: group.key, disabled: !drag.reorderable });
  // A drop ends with a click on the header, which must not toggle the group.
  const dragged = useRef(false);
  if (drag.activeKey === group.key) dragged.current = true;
  return (
    <div
      ref={setNodeRef}
      className={props.className}
      data-task-status-group-header={group.key}
      {...listeners}
      onPointerDownCapture={() => {
        dragged.current = false;
      }}
      onClickCapture={(event) => {
        if (dragged.current) event.stopPropagation();
      }}
      onKeyDown={(event: ReactKeyboardEvent) => {
        if (!drag.reorderable || !event.altKey) return;
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        drag.move(group.key, event.key === "ArrowUp" ? "up" : "down");
      }}
    >
      <SidebarSectionHeader
        title={group.title}
        open={group.open}
        onToggle={() => props.onOpenChange(!group.open)}
        action={<GroupCount count={props.count} />}
      />
    </div>
  );
}

/**
 * The current group's header stays at the top of the list while its tasks
 * scroll under it, on the page's own background.
 */
const STICKY_HEADER_CLASS = "sticky top-0 z-10 bg-background";

/** A group in the card list. Its header lines up with the cards' content on both sides. */
export function TaskStatusCardGroup(props: {
  readonly group: TaskStatusGroup<unknown>;
  readonly count: number;
  readonly onOpenChange: (open: boolean) => void;
  readonly children: ReactNode;
}) {
  const { group } = props;
  const drag = useGroupDrag(group.key);
  const { setNodeRef } = useDroppable({ id: group.key });
  return (
    <div
      ref={setNodeRef}
      className={cn(SIDEBAR_SECTION_GAP, drag.dragging && "opacity-50")}
      data-task-status-group={group.key}
    >
      <Collapsible open={group.open}>
        <GroupHeader
          group={group}
          count={props.count}
          onOpenChange={props.onOpenChange}
          className={cn("px-3", STICKY_HEADER_CLASS)}
        />
        <CollapsiblePanel>
          <div className={cn("flex min-w-0 flex-col", SIDEBAR_SECTION_HEADER_GAP)}>
            {props.children}
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </div>
  );
}

/** A group in the table: a body of its own, so every group keeps the table's columns. */
export function TaskStatusTableGroup(props: {
  readonly group: TaskStatusGroup<unknown>;
  readonly count: number;
  readonly columnCount: number;
  readonly onOpenChange: (open: boolean) => void;
  readonly children: ReactNode;
}) {
  const { group } = props;
  const drag = useGroupDrag(group.key);
  const { setNodeRef } = useDroppable({ id: group.key });
  return (
    <tbody
      ref={setNodeRef}
      className={cn(drag.dragging && "opacity-50")}
      data-task-status-group={group.key}
    >
      <tr>
        {/* A sticky cell holds to the table, so the next group's header slides over this one. */}
        <td
          colSpan={props.columnCount}
          className={cn("px-0 pb-1", SIDEBAR_SECTION_GAP, STICKY_HEADER_CLASS)}
        >
          <GroupHeader
            group={group}
            count={props.count}
            onOpenChange={props.onOpenChange}
            className="-ms-0.5 -me-2"
          />
        </td>
      </tr>
      {group.open ? props.children : null}
    </tbody>
  );
}
