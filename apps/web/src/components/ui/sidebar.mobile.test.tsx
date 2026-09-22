import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("~/hooks/useMediaQuery", () => ({ useIsMobile: () => true }));
// Portals do not render in server markup. Keep Root non-visual, as Base UI does,
// and inspect the props delivered to the actual mobile surface.
vi.mock("~/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => children,
  SheetPopup: ({
    showCloseButton: _,
    ...props
  }: React.ComponentProps<"div"> & { showCloseButton?: boolean }) => <div {...props} />,
  SheetHeader: (props: React.ComponentProps<"div">) => <div {...props} />,
  SheetTitle: (props: React.ComponentProps<"h2">) => <h2 {...props} />,
  SheetDescription: (props: React.ComponentProps<"p">) => <p {...props} />,
}));

import { Sidebar, SidebarProvider } from "./sidebar";

describe("mobile sidebar theme scope", () => {
  it.each(["v1", "v2"])("keeps %s styling and surface attributes through the sheet", (version) => {
    const html = renderToStaticMarkup(
      <SidebarProvider>
        <Sidebar
          data-upcomputer-sidebar-version={version}
          data-sidebar-mode="focus"
          aria-label="Chats"
        >
          Navigation
        </Sidebar>
      </SidebarProvider>,
    );
    expect(html).toContain('data-mobile="true"');
    expect(html).toContain(`data-upcomputer-sidebar-version="${version}"`);
    expect(html).toContain('data-sidebar-mode="focus"');
    expect(html).toContain('aria-label="Chats"');
    expect(html).toContain("upcomputer-sidebar-glass");
  });
});
