import * as ThreadUndo from "@t3tools/client-runtime/state/thread-undo";
import { AsyncResult } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { showThreadUndoNotice, undoLatestThreadAction } from "../../hooks/showThreadUndoNotice";
import { SidebarProvider, useSidebar } from "../ui/sidebar";
import { PhoneUndoNotice } from "./PhoneUndoNotice.upcomputer";

function SheetToggle() {
  const { openMobile, setOpenMobile } = useSidebar();
  return (
    <button type="button" onClick={() => setOpenMobile(!openMobile)}>
      Toggle sheet
    </button>
  );
}

async function phoneWidth(width: number) {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(width, 800);
  return { [Symbol.asyncDispose]: () => page.viewport(viewport.width, viewport.height) };
}

function archive() {
  const restore = vi.fn(() => Promise.resolve(AsyncResult.success(undefined)));
  showThreadUndoNotice({
    action: "Archived",
    failureTitle: "Could not restore the thread",
    undo: restore,
    claim: ThreadUndo.begin("archive", "environment-test/thread-phone"),
  });
  return { restore, [Symbol.dispose]: () => void undoLatestThreadAction() };
}

const card = () => document.querySelector<HTMLElement>("[data-phone-undo-notice]");

// The open sheet covers the page and its own pill carries the notice; closing it brings
// the page's card back. Undo on the card restores the thread.
it("shows under the header only while the sheet is closed", async () => {
  await using _width = await phoneWidth(390);
  using archived = archive();
  await using screen = await render(
    <SidebarProvider>
      <PhoneUndoNotice />
      <SheetToggle />
    </SidebarProvider>,
  );

  await expect.element(screen.getByRole("button", { name: /^Undo/ })).toBeVisible();
  expect(card()!.inert).toBe(false);
  expect(card()!.textContent).toMatch(/^ArchivedUndo/);

  await userEvent.click(screen.getByRole("button", { name: "Toggle sheet" }));
  await vi.waitFor(() => expect(card()?.inert).toBe(true));

  await userEvent.click(screen.getByRole("button", { name: "Toggle sheet" }));
  await vi.waitFor(() => expect(card()?.inert).toBe(false));

  await userEvent.click(screen.getByRole("button", { name: /^Undo/ }));
  expect(archived.restore).toHaveBeenCalledOnce();
});

it.each([
  { where: "a wider screen", width: 1024, path: "/" },
  { where: "Settings", width: 390, path: "/settings" },
  { where: "Usage", width: 390, path: "/usage" },
])("draws no card on $where", async ({ width, path }) => {
  await using _width = await phoneWidth(width);
  using _archived = archive();
  await using screen = await render(
    <SidebarProvider>
      <PhoneUndoNotice />
      <span>Page</span>
    </SidebarProvider>,
    { router: path },
  );
  await expect.element(screen.getByText("Page")).toBeVisible();
  expect(card()).toBeNull();
});
