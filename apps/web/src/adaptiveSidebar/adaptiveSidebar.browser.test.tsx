import "./adaptiveSidebar.css";

import { ArrowLeftIcon } from "lucide-react";
import { describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { SidebarMenu, SidebarMenuButton, SidebarProvider } from "../components/ui/sidebar";
import { SidebarEmptyRow } from "../sidebarProjects/SidebarEmptyRow";
import { SidebarProjectRow } from "../sidebarProjects/SidebarProjectRow";
import { SidebarSectionHeader } from "../sidebarProjects/SidebarSectionHeader";
import { SidebarCompactNewThread, SidebarCompactTooltip } from "./adaptiveSidebar";
import { SIDEBAR_COMPACT_WIDTH } from "./sidebarWidthMode";

const SECTIONS = [
  { title: "Projects", open: true },
  { title: "Bots", open: false },
] as const;

/**
 * The sidebar as it renders: sections with a header in its gap wrapper and a
 * row, the Threads header with its compact New thread, then the thread list.
 */
function SidebarSections(props: { readonly compact: boolean; readonly threadsOpen: boolean }) {
  return (
    <div data-sidebar-compact={String(props.compact)}>
      <div data-app-sidebar="" style={{ width: props.compact ? SIDEBAR_COMPACT_WIDTH : 256 }}>
        {SECTIONS.map((section) => (
          <div key={section.title}>
            <div>
              <SidebarSectionHeader title={section.title} open={section.open} onToggle={() => {}} />
            </div>
            {section.open ? (
              <div data-sidebar-list-row="" className="flex">
                <span data-testid={`${section.title} icon`}>I</span>
                <span>{`${section.title} row`}</span>
                <span>
                  <button type="button" data-slot="task-run-counts">
                    1
                  </button>
                </span>
              </div>
            ) : null}
          </div>
        ))}
        <div data-sidebar-threads-section="">
          <SidebarSectionHeader title="Threads" open={props.threadsOpen} onToggle={() => {}} />
          <button type="button" data-sidebar-compact-new-thread="">
            New thread
          </button>
        </div>
        <div data-slot="sidebar-content">Thread list</div>
      </div>
    </div>
  );
}

const shown = (element: Element | null | undefined) => element?.checkVisibility() ?? false;

describe("compact sidebar sections", () => {
  it("turns an open section's header into a gap and leaves out a collapsed one", async () => {
    await using screen = await render(<SidebarSections compact threadsOpen />);
    const headers = [...screen.container.querySelectorAll("[data-sidebar-section-header]")];
    const [projects, bots] = headers;
    expect([shown(projects), shown(bots)]).toEqual([true, false]);
    expect(shown(projects?.querySelector("button"))).toBe(false);
  });

  it("shows a list row as its icon in a centred 60px square, with no dot for its end", async () => {
    await using screen = await render(<SidebarSections compact threadsOpen />);
    const icon = screen.getByTestId("Projects icon").element();
    const row = icon.parentElement!;
    expect([...row.children].map(shown)).toEqual([true, false, false]);
    expect(getComputedStyle(icon, "::after").content).toBe("none");
    const box = row.getBoundingClientRect();
    const column = row.parentElement!.parentElement!.getBoundingClientRect();
    expect([box.width, box.height]).toEqual([60, 60]);
    expect(box.left - column.left).toBe(column.right - box.right);
  });

  it("leaves the thread list out and keeps New thread, even with Threads collapsed", async () => {
    await using screen = await render(<SidebarSections compact threadsOpen={false} />);
    expect(shown(screen.getByText("Thread list").element())).toBe(false);
    expect(shown(screen.getByRole("button", { name: "New thread" }).element())).toBe(true);
  });

  it("leaves the full sidebar as it is", async () => {
    await using screen = await render(<SidebarSections compact={false} threadsOpen />);
    await expect.element(screen.getByRole("button", { name: "Bots" })).toBeVisible();
    await expect.element(screen.getByText("Projects row")).toBeVisible();
    await expect.element(screen.getByText("Thread list")).toBeVisible();
    expect(shown(screen.container.querySelector("[data-sidebar-compact-new-thread]"))).toBe(false);
  });

  it("names every compact row, which shows only its icon", async () => {
    await page.viewport(1280, 800);
    localStorage.setItem("upcomputer:sidebar-compact", "true");
    using _stored = {
      [Symbol.dispose]: () => localStorage.removeItem("upcomputer:sidebar-compact"),
    };
    await using screen = await render(
      <SidebarProvider>
        <div data-sidebar-compact="true">
          <div data-app-sidebar="">
            <SidebarMenu>
              <SidebarCompactTooltip label="Tasks">
                <SidebarMenuButton>
                  <span>I</span>
                  <span>Tasks</span>
                  <span>3</span>
                </SidebarMenuButton>
              </SidebarCompactTooltip>
              <SidebarProjectRow
                label="Alpha"
                icon={<span>A</span>}
                isActive={false}
                newChatLabel="New chat in Alpha"
                onSelect={() => {}}
                onNewChat={() => {}}
              />
              <SidebarEmptyRow label="Add a project" onClick={() => {}} />
            </SidebarMenu>
            <SidebarCompactTooltip label="Ada: Waiting for your answer">
              <div role="button" tabIndex={0} data-sidebar-list-row="">
                <span>F</span>
                <span>Ada</span>
              </div>
            </SidebarCompactTooltip>
            <SidebarCompactNewThread tooltip="New thread (mod+N)" onClick={() => {}} />
            <div data-sidebar="footer">
              <SidebarMenu>
                <SidebarMenuButton data-track="sidebar.back">
                  <ArrowLeftIcon />
                  <span>Back</span>
                </SidebarMenuButton>
              </SidebarMenu>
            </div>
          </div>
        </div>
      </SidebarProvider>,
    );
    for (const name of [
      "Tasks",
      "Alpha",
      "Add a project",
      "Ada: Waiting for your answer",
      "New thread",
      "Back",
    ]) {
      await expect.element(screen.getByRole("button", { name, exact: true })).toBeVisible();
    }
  });
});
