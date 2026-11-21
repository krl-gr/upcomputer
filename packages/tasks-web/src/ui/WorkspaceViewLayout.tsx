import { useCallback, useEffect, type ReactNode } from "react";
import { PlusIcon } from "lucide-react";

import { Button } from "../../../../apps/web/src/components/ui/button.tsx";
import { isElectron } from "../../../../apps/web/src/env.ts";
import { WorkspacePageHeader } from "../../../../apps/web/src/extensionApi.ts";
import { SidebarInset } from "../../../../apps/web/src/components/ui/sidebar.tsx";
import { TASKS_HEADER_CONTAINER_CLASS } from "../planner/ui/HeaderSwitchLabel.tsx";
import { FloatingActions } from "./FloatingActions.tsx";

export interface WorkspaceViewAction {
  readonly ariaLabel: string;
  /** The analytics name for clicks; see apps/web `uiAnalytics.ts`. */
  readonly track?: string;
  readonly disabled?: boolean;
  readonly icon?: ReactNode;
  readonly hideIcon?: boolean;
  readonly label?: string;
  readonly onClick: () => void;
  readonly title?: string;
}

/**
 * A header button: the shared outline button at the planner list header's
 * size, an icon alone or with its label.
 */
function HeaderAction(props: { readonly action: WorkspaceViewAction }) {
  const { action } = props;
  const icon = action.hideIcon ? null : action.icon;
  return (
    <Button
      variant="outline"
      size={action.label ? "sm" : "icon-sm"}
      aria-label={action.ariaLabel}
      data-track={action.track}
      disabled={action.disabled}
      onClick={action.onClick}
      title={action.title ?? action.ariaLabel}
    >
      {icon}
      {action.label}
    </Button>
  );
}

/** The view's action over a headerless list: the large round button in the corner. */
function FloatingMainAction(props: { readonly action: WorkspaceViewAction }) {
  const { action } = props;
  return (
    <Button
      variant="floating"
      size="icon-floating"
      aria-label={action.ariaLabel}
      data-track={action.track}
      disabled={action.disabled}
      onClick={action.onClick}
      title={action.title ?? action.ariaLabel}
    >
      {action.icon ?? <PlusIcon />}
    </Button>
  );
}

/**
 * The horizontal gutters of upstream's `WorkspacePageHeader`, so page content
 * starts under the page title and ends under the header's last control.
 */
const WORKSPACE_CONTENT_GUTTER_CLASS = "pl-(--workspace-gutter-start) pr-(--workspace-gutter-end)";

/**
 * What leads the header: the Tasks workspace's switches (Me / Workers and the
 * section switch), or a title for a view without them, such as a create mode.
 * Never both, so a view with the switches cannot add a page title beside them.
 */
type WorkspaceViewHeading =
  | { readonly switches: ReactNode; readonly title?: never }
  | { readonly title?: string; readonly switches?: never };

/**
 * Shared main-area shell of the Tasks, Agents and Automations routes: upstream's
 * page header (switches, title or back control on the left, controls on the right)
 * over content inside the same gutters. The sidebar toggle is upstream's shared one.
 *
 * The `panel` variant fits a right-panel surface: the header is the planner
 * list header's frame without title bar duties, appears only with something
 * in it, and Escape only acts from inside the view.
 */
export function WorkspaceViewLayout({
  title,
  switches,
  action,
  leadingAction,
  toolbar,
  children,
  onNavigateBack,
  navigateOnEscape = true,
  inset = true,
  header = true,
  floatingControls = false,
  variant = "page",
}: WorkspaceViewHeading & {
  readonly action?: WorkspaceViewAction | undefined;
  readonly leadingAction?: WorkspaceViewAction | undefined;
  readonly toolbar?: ReactNode | undefined;
  readonly children: ReactNode;
  readonly onNavigateBack: () => void;
  /** The planner keeps Escape for its windows, menus and inline edits. */
  readonly navigateOnEscape?: boolean;
  /**
   * Content sits inside the header's gutters. The planner turns this off so its
   * pane borders run edge to edge, and pads its own content.
   */
  readonly inset?: boolean;
  /**
   * Off for the planner: its list and week headers are the page's title bar
   * row, so the page header (and with it the title) is left out.
   */
  readonly header?: boolean;
  /**
   * A panel view opened by its own launcher entry: the list has no header, and its
   * toolbar and action float over its bottom right corner. A view with a back
   * control or a title (a task's details, a create form) keeps the header.
   */
  readonly floatingControls?: boolean;
  readonly variant?: "page" | "panel" | undefined;
}) {
  const navigateBack = useCallback(() => onNavigateBack(), [onNavigateBack]);
  const panel = variant === "panel";

  useEffect(() => {
    if (!navigateOnEscape || panel) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "Escape") return;
      event.preventDefault();
      navigateBack();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigateBack, navigateOnEscape, panel]);

  const headerContent = (
    <>
      {leadingAction ? <HeaderAction action={leadingAction} /> : null}
      {title ? (
        <h1
          className={`${toolbar ? "shrink-0" : "flex-1"} min-w-0 truncate text-sm font-medium text-foreground`}
        >
          {title}
        </h1>
      ) : null}
      {switches || toolbar ? (
        <div
          className={
            panel
              ? "flex min-w-0 flex-1 items-center gap-1.5"
              : "flex min-w-0 flex-1 items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          }
        >
          {switches ? (
            // The planner list header's spacing, so the switches sit alike on every tab.
            <div className="flex shrink-0 items-center gap-1.5">{switches}</div>
          ) : null}
          {toolbar}
        </div>
      ) : null}
      {action ? (
        <HeaderAction
          action={{
            ...action,
            icon: action.hideIcon ? undefined : (action.icon ?? <PlusIcon />),
          }}
        />
      ) : null}
    </>
  );

  if (panel) {
    const floating = floatingControls && !leadingAction && !title;
    return (
      <div
        className="relative flex min-h-0 min-w-0 flex-1 flex-col text-foreground"
        onKeyDown={(event) => {
          if (!navigateOnEscape || event.defaultPrevented || event.key !== "Escape") return;
          event.preventDefault();
          navigateBack();
        }}
      >
        {floating ? (
          toolbar || action ? (
            <FloatingActions>
              {toolbar}
              {action ? <FloatingMainAction action={action} /> : null}
            </FloatingActions>
          ) : null
        ) : header && (leadingAction || title || switches || toolbar || action) ? (
          // The planner list header's frame, so Me and Workers share one header.
          <WorkspacePageHeader
            clearCollapsedSidebar={false}
            className={`${TASKS_HEADER_CONTAINER_CLASS} border-b border-border`}
          >
            <div className="flex min-w-0 flex-1 items-center gap-1">{headerContent}</div>
          </WorkspacePageHeader>
        ) : null}
        <div
          className={`flex min-h-0 flex-1 flex-col overflow-y-auto ${inset ? WORKSPACE_CONTENT_GUTTER_CLASS : ""}`}
        >
          {children}
        </div>
      </div>
    );
  }

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col text-foreground">
        {header ? (
          <WorkspacePageHeader electron={isElectron} className={TASKS_HEADER_CONTAINER_CLASS}>
            {headerContent}
          </WorkspacePageHeader>
        ) : null}
        <div
          className={`min-h-0 flex flex-1 flex-col overflow-auto ${inset ? WORKSPACE_CONTENT_GUTTER_CLASS : ""}`}
        >
          {children}
        </div>
      </div>
    </SidebarInset>
  );
}
