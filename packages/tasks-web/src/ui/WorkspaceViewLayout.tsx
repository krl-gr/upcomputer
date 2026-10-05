/* oxlint-disable t3code/no-native-title-tooltip -- ported V1 Tasks UI; moves to Tooltip with the product UI phase. */
import { useCallback, useEffect, type ReactNode } from "react";
import { PlusIcon } from "lucide-react";

import { isElectron } from "../../../../apps/web/src/env.ts";
import { WorkspacePageHeader } from "../../../../apps/web/src/extensionApi.ts";
import { SidebarInset } from "../../../../apps/web/src/components/ui/sidebar.tsx";

export interface WorkspaceViewAction {
  readonly ariaLabel: string;
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
 */
export function WorkspaceViewLayout({
  title,
  titleDetail,
  action,
  leadingAction,
  toolbar,
  children,
  onNavigateBack,
}: {
  readonly title: string;
  /** Muted context after the title, e.g. the sidebar's project filter ("Agents · Repo"). */
  readonly titleDetail?: string | undefined;
  readonly action?: WorkspaceViewAction | undefined;
  readonly leadingAction?: WorkspaceViewAction | undefined;
  readonly toolbar?: ReactNode | undefined;
  readonly children: ReactNode;
  readonly onNavigateBack: () => void;
}) {
  const navigateBack = useCallback(() => onNavigateBack(), [onNavigateBack]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "Escape") return;
      event.preventDefault();
      navigateBack();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigateBack]);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col text-foreground">
        <WorkspacePageHeader electron={isElectron}>
          {leadingAction ? (
            <button
              aria-label={leadingAction.ariaLabel}
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
              {titleDetail ? (
                <span
                  className="font-normal text-muted-foreground"
                  title={`Filtered to ${titleDetail}`}
                >
                  {" · "}
                  {titleDetail}
                </span>
              ) : null}
            </h1>
          ) : null}
          {toolbar ? (
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {toolbar}
            </div>
          ) : null}
          {action ? (
            <button
              aria-label={action.ariaLabel}
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
        </WorkspacePageHeader>
        <div
          className={`min-h-0 flex flex-1 flex-col overflow-auto ${WORKSPACE_CONTENT_GUTTER_CLASS}`}
        >
          {children}
        </div>
      </div>
    </SidebarInset>
  );
}
