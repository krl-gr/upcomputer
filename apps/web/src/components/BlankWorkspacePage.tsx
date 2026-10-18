import { isElectron } from "../env";
import { SidebarInset } from "./ui/sidebar";
import { WorkspacePageHeader } from "./WorkspacePageHeader";

/**
 * UpComputer: an empty page beside the sidebar while the real one loads.
 * Rendering nothing there would leave the window's own background (the macOS
 * vibrancy) where the page then appears.
 */
export function BlankWorkspacePage() {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      {isElectron ? <WorkspacePageHeader electron /> : null}
    </SidebarInset>
  );
}
