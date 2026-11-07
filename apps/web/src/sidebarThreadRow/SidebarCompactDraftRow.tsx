import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { replaceComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import { EllipsisIcon } from "lucide-react";
import {
  memo,
  useEffect,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

import { resolveSidebarRowAccessibility } from "../components/Sidebar.logic";
import type { ComposerThreadDraftState, DraftId, DraftSessionState } from "../composerDraftStore";
import { cn } from "../lib/utils";
import { SIDEBAR_LIST_ROW_SPACING } from "../sidebarMetrics/sidebarMetrics";
import {
  SIDEBAR_LIST_ROW,
  SIDEBAR_LIST_ROW_ACTIVE,
  SIDEBAR_LIST_ROW_REST,
  SidebarListRowEnd,
  sidebarListRowActionClassName,
  sidebarListRowFadingLabelClassName,
  sidebarListRowTitleClassName,
} from "./sidebarListRow";
import { compactRelativeTimeLabel } from "./SidebarCompactThreadRow";
import { SidebarThreadProjectIcons } from "./SidebarThreadProjectIcons";
import { DRAFT_STATUS_LABEL, ThreadStatusLabel } from "./ThreadStatusLabel";

const NO_LINKED_PROJECTS: ReadonlyArray<never> = [];
const MENU_CLOSING_KEYS = new Set(["Escape", "Enter", " ", "Tab"]);

/** The draft's first line, or its attachment count when it has no text. */
function draftPreview(composer: ComposerThreadDraftState): string {
  const prompt =
    replaceComposerContextReferences(composer.prompt, (occurrence) => occurrence.label)
      .trim()
      .split("\n", 1)[0] ?? "";
  if (prompt.length > 0) return prompt;
  // images mirrors persistedAttachments once rehydration finishes, hence max not sum.
  const count =
    Math.max(composer.images.length, composer.persistedAttachments.length) +
    composer.files.length +
    composer.terminalContexts.length +
    composer.previewAnnotations.length +
    composer.reviewComments.length;
  return `${count} attachment${count === 1 ? "" : "s"}`;
}

/**
 * A new chat's unsent draft as a compact thread row: project icons, a quiet
 * "Draft" label, the draft's text and when it was started. The "…" button and
 * right-click open the draft's menu, which discards it.
 */
export const SidebarCompactDraftRow = memo(function SidebarCompactDraftRow(props: {
  readonly draftId: DraftId;
  readonly session: DraftSessionState;
  readonly composer: ComposerThreadDraftState;
  readonly project: EnvironmentProject | null;
  readonly projectDisplayName: string | null;
  readonly isActive: boolean;
  readonly onNavigate: (draftId: DraftId) => void;
  readonly onContextMenu: (draftId: DraftId, position: { x: number; y: number }) => void;
}) {
  const { draftId, onContextMenu, onNavigate } = props;
  const preview = draftPreview(props.composer);
  const accessibility = resolveSidebarRowAccessibility({
    title: preview,
    statusLabel: "Unsent draft",
    projectDisplayName: props.projectDisplayName,
    isActive: props.isActive,
  });

  // The draft menu reports no close, as upstream's thread menu.
  const [menuOpen, setMenuOpen] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- listens for the native menu's dismissal, which React does not see
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    const closeOnKey = (event: KeyboardEvent) => {
      if (MENU_CLOSING_KEYS.has(event.key)) close();
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", closeOnKey, true);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", closeOnKey, true);
    };
  }, [menuOpen]);
  const openMenu = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuOpen(true);
    onContextMenu(draftId, { x: rect.left, y: rect.bottom + 4 });
  };
  const handleKeyDown = (event: ReactKeyboardEvent) => {
    if ((event.target as HTMLElement).closest("button")) return;
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      onContextMenu(draftId, { x: rect.left, y: rect.bottom });
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onNavigate(draftId);
    }
  };

  return (
    <li className={cn("list-none", SIDEBAR_LIST_ROW_SPACING)}>
      <div
        role="button"
        tabIndex={0}
        data-sidebar-row={`draft:${draftId}`}
        aria-label={accessibility.label}
        aria-current={accessibility.current}
        data-testid="sidebar-draft-row"
        className={cn(
          SIDEBAR_LIST_ROW,
          props.isActive
            ? SIDEBAR_LIST_ROW_ACTIVE
            : menuOpen
              ? "bg-sidebar-row-hover text-sidebar-foreground"
              : SIDEBAR_LIST_ROW_REST,
        )}
        onClick={() => onNavigate(draftId)}
        onContextMenu={(event) => {
          event.preventDefault();
          onContextMenu(draftId, { x: event.clientX, y: event.clientY });
        }}
        onKeyDown={handleKeyDown}
      >
        <SidebarThreadProjectIcons
          thread={{
            environmentId: props.session.environmentId,
            linkedProjectIds: NO_LINKED_PROJECTS,
          }}
          project={props.project}
        />
        <ThreadStatusLabel status={DRAFT_STATUS_LABEL} />
        <span aria-hidden className={sidebarListRowTitleClassName(props.isActive)}>
          {preview}
        </span>
        <SidebarListRowEnd
          pinned={menuOpen}
          action={
            <button
              type="button"
              aria-label={`Draft actions for ${preview}`}
              className={sidebarListRowActionClassName(menuOpen)}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={openMenu}
            >
              <EllipsisIcon />
            </button>
          }
        >
          <span data-fading-label className={sidebarListRowFadingLabelClassName(menuOpen)}>
            {compactRelativeTimeLabel(props.session.createdAt)}
          </span>
        </SidebarListRowEnd>
      </div>
    </li>
  );
});
