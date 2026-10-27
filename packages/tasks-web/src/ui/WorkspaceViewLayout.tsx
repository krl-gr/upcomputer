/* oxlint-disable t3code/no-native-title-tooltip -- ported V1 Tasks UI; moves to Tooltip with the product UI phase. */
import { useCallback, useEffect, type ReactNode } from "react";
import { PlusIcon } from "lucide-react";

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
 * The horizontal gutters of upstream's `WorkspacePageHeader`, so page content
 * starts under the page title and ends under the header's last control.
 */
const WORKSPACE_CONTENT_GUTTER_CLASS = "pl-(--workspace-gutter-start) pr-(--workspace-gutter-end)";

/**
 * Shared main-area shell of the Tasks, Agents and Automations routes: upstream's
 * page header (title or back control on the left, controls on the right) over
 * content inside the same gutters. The sidebar toggle is upstream's shared one.
 *
 * The `panel` variant fits a right-panel surface: the panel's tab bar is the
 * chrome, so the header is a plain row that wraps its controls at narrow widths,
 * appears only with something in it, and Escape only acts from inside the view.
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
      {leadingAction ? (
        <button
          aria-label={leadingAction.ariaLabel}
          data-track={leadingAction.track}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 dark:hover:bg-white/[0.05] [-webkit-app-region:no-drag]"
          disabled={leadingAction.disabled}
          onClick={leadingAction.onClick}
          title={leadingAction.title ?? leadingAction.ariaLabel}
          type="button"
        >
          {leadingAction.icon}
          {leadingAction.label ? <span>{leadingAction.label}</span> : null}
        </button>
      ) : null}
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
              ? "contents"
              : "flex min-w-0 flex-1 items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          }
        >
          {toolbar}
        </div>
      ) : null}
      {action ? (
        <button
          aria-label={action.ariaLabel}
          data-track={action.track}
          className={`${action.label ? "h-8 gap-1.5 rounded-md px-2 font-medium text-foreground" : "size-8 rounded-full text-muted-foreground"} inline-flex shrink-0 items-center justify-center transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 dark:hover:bg-white/[0.05] [-webkit-app-region:no-drag]`}
          disabled={action.disabled}
          onClick={action.onClick}
          title={action.title ?? action.ariaLabel}
          type="button"
        >
          {action.hideIcon ? null : (action.icon ?? <PlusIcon className="size-4" />)}
          {action.label ? <span className="text-sm">{action.label}</span> : null}
        </button>
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
          <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 pt-2">
            {headerContent}
          </div>
        ) : null}
        <div className={`flex min-h-0 flex-1 flex-col overflow-y-auto ${inset ? "px-3" : ""}`}>
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
