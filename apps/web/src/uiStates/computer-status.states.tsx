import type { ReactNode } from "react";
import { it } from "vite-plus/test";

import { ComputerIcon } from "../sidebarComputers/SidebarComputersSection";
import type { ComputerStatus, SidebarComputer } from "../sidebarComputers/useSidebarComputers";
import { captureUiStateSheet, type UiState } from "./uiStateSheet";

// Only the fields the icon reads.
const computer = (status: ComputerStatus) =>
  ({ machine: "laptop", status }) as unknown as SidebarComputer;

const BACKGROUNDS: ReadonlyArray<{ readonly name: string; readonly className: string }> = [
  { name: "sidebar", className: "bg-sidebar" },
  { name: "selected row", className: "bg-sidebar-accent" },
  { name: "wallpaper", className: "bg-linear-to-br from-amber-700 via-stone-600 to-sky-800" },
];

const row = (status: ComputerStatus, className: string) => (): ReactNode => (
  <div className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${className}`}>
    <ComputerIcon computer={computer(status)} />
    <span className="text-sm">{status}</span>
  </div>
);

const STATUSES: ReadonlyArray<ComputerStatus> = ["online", "outdated", "connecting", "offline"];

it("computer-status", async () => {
  await captureUiStateSheet(
    "computer-status",
    BACKGROUNDS.map((background) => ({
      title: `On ${background.name}`,
      states: STATUSES.map((status): UiState => ({
        name: status,
        render: row(status, background.className),
      })),
    })),
    { densities: ["retina"] },
  );
});
