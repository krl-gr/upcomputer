import { useCallback, useEffect, type ReactNode } from "react";
import { PlusIcon } from "lucide-react";

import { Button } from "../../../../apps/web/src/components/ui/button.tsx";
import { isElectron } from "../../../../apps/web/src/env.ts";
import { WorkspacePageHeader } from "../../../../apps/web/src/extensionApi.ts";
import { SidebarInset } from "../../../../apps/web/src/components/ui/sidebar.tsx";

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

/**
 * The horizontal gutters of upstream's `WorkspacePageHeader`, so page content
 * starts under the page title and ends under the header's last control.
 */
const WORKSPACE_CONTENT_GUTTER_CLASS = "pl-(--workspace-gutter-start) pr-(--workspace-gutter-end)";

/**
 * Shared main-area shell of the Tasks, Agents and Automations routes: upstream's
 * page header (title or back control on the left, controls on the right) over
 * content inside the same gutters. The sidebar toggle is upstream's shared one.
 *
 * The `panel` variant fits a right-panel surface: the header is the planner
 * list header's frame without title bar duties, appears only with something
 * in it, and Escape only acts from inside the view.
 */
export function WorkspaceViewLayout({
  title,
  action,
  leadingAction,
  toolbar,
  children,
  onNavigateBack,
  navigateOnEscape = true,
  inset = true,
  header = true,
  variant = "page",
}: {
  readonly title: string;
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
      {toolbar ? (
        <div
          className={
            panel
              ? "flex min-w-0 flex-1 items-center gap-1.5"
              : "flex min-w-0 flex-1 items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          }
        >
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
    return (
      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col text-foreground"
        onKeyDown={(event) => {
          if (!navigateOnEscape || event.defaultPrevented || event.key !== "Escape") return;
          event.preventDefault();
          navigateBack();
        }}
      >
        {header && (leadingAction || title || toolbar || action) ? (
          // The planner list header's frame, so Me and Workers share one header.
          <WorkspacePageHeader clearCollapsedSidebar={false} className="border-b border-border">
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
          <WorkspacePageHeader electron={isElectron}>{headerContent}</WorkspacePageHeader>
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
