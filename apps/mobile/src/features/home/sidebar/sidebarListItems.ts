import {
  threadListV2ListItemsAreEqual,
  type ThreadListV2ListItem,
} from "../../threads/threadListV2";

/** The header of the desktop sidebar's Pinned or Threads group, as a row of the chats list. */
export interface SidebarGroupHeaderItem {
  readonly type: "sidebar-group";
  readonly key: string;
  readonly group: "pinned" | "threads";
  readonly open: boolean;
}

export type SidebarListItem = ThreadListV2ListItem | SidebarGroupHeaderItem;

const isShelf = (item: ThreadListV2ListItem) =>
  item.type === "v2-working-shelf" ||
  item.type === "v2-snoozed-shelf" ||
  item.type === "v2-settled-shelf";

/**
 * The thread list in the desktop sidebar's groups: Pinned (only with a pinned thread), then
 * Threads, each closing to its header. The shelves after them keep their own headers.
 */
export function sidebarListItems(
  items: ReadonlyArray<ThreadListV2ListItem>,
  open: { readonly pinned: boolean; readonly threads: boolean },
): ReadonlyArray<SidebarListItem> {
  const shelvesAt = items.findIndex(isShelf);
  const active = shelvesAt < 0 ? items : items.slice(0, shelvesAt);
  const shelves = shelvesAt < 0 ? [] : items.slice(shelvesAt);
  const pinned = active.filter((item) => item.type === "v2-thread" && item.item.pinned);
  const threads = active.filter((item) => !(item.type === "v2-thread" && item.item.pinned));
  return [
    ...(pinned.length > 0
      ? [
          {
            type: "sidebar-group",
            key: "group:pinned",
            group: "pinned",
            open: open.pinned,
          } as const,
          ...(open.pinned ? pinned : []),
        ]
      : []),
    { type: "sidebar-group", key: "group:threads", group: "threads", open: open.threads } as const,
    ...(open.threads ? threads : []),
    ...shelves,
  ];
}

export function sidebarListItemsAreEqual(previous: SidebarListItem, item: SidebarListItem) {
  if (item.type === "sidebar-group")
    return (
      previous.type === "sidebar-group" && previous.key === item.key && previous.open === item.open
    );
  return previous.type !== "sidebar-group" && threadListV2ListItemsAreEqual(previous, item);
}

/** As on the desktop: three projects, the picked one taking the last place, then More. */
const SIDEBAR_PROJECT_PREVIEW_COUNT = 3;

/** The projects the Projects group lists before its More row. */
export function previewProjects<T extends { readonly key: string }>(
  projects: ReadonlyArray<T>,
  selectedKey: string | null,
): ReadonlyArray<T> {
  const first = projects.slice(0, SIDEBAR_PROJECT_PREVIEW_COUNT);
  const picked = projects.find((project) => project.key === selectedKey);
  if (!picked || first.includes(picked)) return first;
  return [...first.slice(0, SIDEBAR_PROJECT_PREVIEW_COUNT - 1), picked];
}
