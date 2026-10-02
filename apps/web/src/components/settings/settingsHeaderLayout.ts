import { cn } from "~/lib/utils";
import { resolveLeftEdgeTitlebarInsetClass } from "~/workspaceTitlebar";

const ELECTRON_SETTINGS_HEADER_CLASS =
  "drag-region flex h-[52px] shrink-0 items-center px-5 transition-[padding-left] duration-200 ease-linear motion-reduce:transition-none wco:h-[env(titlebar-area-height)] wco:pr-[calc(100vw-env(titlebar-area-width)-env(titlebar-area-x)+1em)]";
const WEB_SETTINGS_HEADER_CLASS =
  "px-3 py-2 transition-[padding-left] duration-200 ease-linear motion-reduce:transition-none sm:px-5";

/** One header serves the section list and every section, so the route is no input. */
export function resolveSettingsHeaderClassName(input: {
  readonly isElectron: boolean;
  readonly isMobile: boolean;
}): string {
  return cn(
    input.isElectron ? ELECTRON_SETTINGS_HEADER_CLASS : WEB_SETTINGS_HEADER_CLASS,
    resolveLeftEdgeTitlebarInsetClass(input),
  );
}
