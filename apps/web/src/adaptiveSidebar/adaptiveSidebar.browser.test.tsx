import "./adaptiveSidebar.css";

import { describe, expect, it } from "vite-plus/test";

import { render } from "../../test/render";
import { SidebarSectionHeader } from "../sidebarProjects/SidebarSectionHeader";

const SECTIONS = [
  { title: "Projects", open: true },
  { title: "Bots", open: false },
  { title: "Threads", open: true },
] as const;

/** The sidebar's sections as they render: a header in its gap wrapper, then the open section's row. */
function SidebarSections(props: { readonly compact: boolean }) {
  return (
    <div data-sidebar-compact={String(props.compact)}>
      <div data-app-sidebar="">
        {SECTIONS.map((section) => (
          <div key={section.title}>
            <div>
              <SidebarSectionHeader title={section.title} open={section.open} onToggle={() => {}} />
            </div>
            {section.open ? (
              <div data-sidebar-list-row="">
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
      </div>
    </div>
  );
}

const dotContent = (element: Element) => getComputedStyle(element, "::after").content;
const shown = (element: Element | null | undefined) => element?.checkVisibility() ?? false;

describe("compact sidebar sections", () => {
  it("turns an open section's header into a divider and leaves out a collapsed one", async () => {
    await using screen = await render(<SidebarSections compact />);
    const headers = [...screen.container.querySelectorAll("[data-sidebar-section-header]")];
    const [projects, bots, threads] = headers;
    expect([shown(projects), shown(bots), shown(threads)]).toEqual([true, false, true]);
    expect(shown(projects?.querySelector("button"))).toBe(false);
  });

  it("shows a row as its icon, with its end's count as a dot", async () => {
    await using screen = await render(<SidebarSections compact />);
    const icon = screen.getByTestId("Projects icon").element();
    const row = icon.parentElement!;
    expect([...row.children].map(shown)).toEqual([true, false, false]);
    expect(dotContent(icon)).toBe('""');
  });

  it("leaves the full sidebar as it is", async () => {
    await using screen = await render(<SidebarSections compact={false} />);
    await expect.element(screen.getByRole("button", { name: "Bots" })).toBeVisible();
    await expect.element(screen.getByText("Projects row")).toBeVisible();
    expect(dotContent(screen.getByTestId("Projects icon").element())).toBe("none");
  });
});
