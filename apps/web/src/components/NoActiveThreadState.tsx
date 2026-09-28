import { MessageSquareDashedIcon } from "lucide-react";

import { useScratchProject } from "../hooks/useScratchProject";
import { usePrimaryEnvironmentId } from "../state/environments";
import { Button } from "./ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import { SidebarInset } from "./ui/sidebar";
import { isElectron } from "../env";
import { cn } from "~/lib/utils";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";

export function NoActiveThreadContent() {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { scratchEnvironmentId, startScratchThread } = useScratchProject();
  const scratchTargetEnvironmentId = scratchEnvironmentId(primaryEnvironmentId);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
      <header
        className={cn(
          "border-b border-border px-3 transition-[padding-left] duration-200 ease-linear motion-reduce:transition-none sm:px-5",
          isElectron ? "workspace-topbar drag-region" : "workspace-topbar",
          COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
        )}
      >
        {isElectron ? (
          <span className="text-xs text-muted-foreground/50 wco:pr-[var(--workspace-native-controls-inset)]">
            No active thread
          </span>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground md:text-muted-foreground/60">
              No active thread
            </span>
          </div>
        )}
      </header>

      <Empty className="flex-1">
        <div className="w-full max-w-lg px-8 py-12">
          <EmptyHeader className="max-w-none">
            <EmptyTitle className="text-foreground text-xl">Pick a thread to continue</EmptyTitle>
            <EmptyDescription className="mt-2 text-sm text-muted-foreground/78">
              Select an existing thread or create a new one to get started.
            </EmptyDescription>
            {scratchTargetEnvironmentId === null ? null : (
              <div className="mt-5 flex justify-center">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void startScratchThread({ environmentId: scratchTargetEnvironmentId })
                  }
                >
                  <MessageSquareDashedIcon className="size-4" />
                  Start without a project
                </Button>
              </div>
            )}
          </EmptyHeader>
        </div>
      </Empty>
    </div>
  );
}

export function NoActiveThreadState() {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <NoActiveThreadContent />
    </SidebarInset>
  );
}
