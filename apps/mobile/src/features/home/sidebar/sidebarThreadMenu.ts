import type { MenuAction } from "@react-native-menu/menu";
import { msg } from "gt-react-native";

import { m, type MessageResolver } from "../../../i18n/messages";

export interface SidebarThreadMenuInput {
  readonly branch: string | null;
  readonly pinned: boolean | null;
  /** The snooze presets to offer, or "wake" for a snoozed thread; null when it can't snooze. */
  readonly snooze: ReadonlyArray<MenuAction> | "wake" | null;
  readonly regenerateTitle: "available" | "running" | null;
  readonly shareWithGuest: boolean;
  /** The project a filter would pick, or "all" while the list is filtered to it. */
  readonly filter: { readonly project: string } | "all" | null;
  readonly turnIntoProject: { readonly enabled: boolean } | null;
  readonly path: boolean;
  readonly archivable: boolean;
}

const inline = (id: string, subactions: MenuAction[]): MenuAction => ({
  id,
  title: "",
  displayInline: true,
  subactions,
});

/**
 * A thread row's long-press menu: the desktop sidebar's thread menu (`threadActionMenu.logic.ts`)
 * in its order and words, minus Find in thread and Settle, which the phone doesn't have.
 */
export function sidebarThreadMenuActions(
  input: SidebarThreadMenuInput,
  resolve: MessageResolver = m,
): MenuAction[] {
  const top: MenuAction[] = [
    ...(input.branch
      ? [
          {
            id: "new-thread-on-branch",
            title: resolve(msg("New thread on {branch}", { branch: input.branch })),
            image: "square.and.pencil",
          },
        ]
      : []),
    ...(input.pinned === null
      ? []
      : [
          input.pinned
            ? { id: "unpin", title: resolve(msg("Unpin thread")), image: "pin.slash" }
            : { id: "pin", title: resolve(msg("Pin thread")), image: "pin" },
        ]),
    ...(input.snooze === "wake"
      ? [{ id: "unsnooze", title: resolve(msg("Wake thread")), image: "clock" }]
      : input.snooze
        ? [
            {
              id: "snooze",
              title: resolve(msg("Snooze", { $context: "verb, thread action" })),
              image: "clock",
              subactions: [...input.snooze],
            },
          ]
        : []),
  ];
  const thread: MenuAction[] = [
    { id: "rename", title: resolve(msg("Rename thread")), image: "pencil" },
    ...(input.regenerateTitle
      ? [
          {
            id: "regenerate-title",
            title:
              input.regenerateTitle === "running"
                ? resolve(msg("Regenerating…"))
                : resolve(msg("Regenerate title")),
            image: "arrow.clockwise",
            attributes: { disabled: input.regenerateTitle === "running" },
          },
        ]
      : []),
    { id: "mark-unread", title: resolve(msg("Mark unread")), image: "envelope.badge" },
    ...(input.shareWithGuest
      ? [{ id: "share-guest", title: resolve(msg("Share with guest")), image: "person.badge.plus" }]
      : []),
    ...(input.filter === null
      ? []
      : [
          input.filter === "all"
            ? { id: "show-all-projects", title: resolve(msg("Show all projects")), image: "folder" }
            : {
                id: "filter-project",
                title: resolve(msg("Filter by {project}", { project: input.filter.project })),
                image: "folder",
              },
        ]),
    ...(input.turnIntoProject
      ? [
          {
            id: "turn-into-project",
            title: resolve(msg("Turn into project")),
            image: "folder.badge.plus",
            attributes: { disabled: !input.turnIntoProject.enabled },
          },
        ]
      : []),
  ];
  // The desktop opens its New bot page from here; the phone gets that page in a later part.
  const feature: MenuAction[] = [
    {
      id: "turn-into-bot",
      title: resolve(msg("Turn into bot")),
      attributes: { disabled: true },
    },
  ];
  const copy: MenuAction[] = [
    {
      id: "copy",
      title: resolve(msg("Copy", { $context: "menu with things to copy" })),
      image: "doc.on.doc",
      subactions: [
        ...(input.path ? [{ id: "copy-path", title: resolve(msg("Path")), image: "folder" }] : []),
        ...(input.branch
          ? [{ id: "copy-branch", title: resolve(msg("Branch")), image: "arrow.triangle.branch" }]
          : []),
        { id: "copy-thread", title: resolve(msg("Thread")), image: "text.bubble" },
        { id: "copy-thread-id", title: resolve(msg("Thread ID")), image: "number" },
      ],
    },
    { id: "project-settings", title: resolve(msg("Project settings")), image: "gearshape" },
  ];
  const end: MenuAction[] = [
    {
      id: "archive",
      title: resolve(msg("Archive thread")),
      image: "archivebox",
      attributes: { disabled: !input.archivable },
    },
    {
      id: "delete",
      title: resolve(msg("Delete", { $context: "verb, thread action" })),
      image: "trash",
      attributes: { destructive: true },
    },
  ];
  return [
    ...(top.length > 0 ? [inline("top", top)] : []),
    inline("thread", thread),
    inline("feature", feature),
    inline("copy", copy),
    inline("end", end),
  ];
}
