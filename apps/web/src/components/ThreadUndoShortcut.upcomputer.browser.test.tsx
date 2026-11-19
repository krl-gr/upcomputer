import * as ThreadUndo from "@t3tools/client-runtime/state/thread-undo";
import { AsyncResult } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { showThreadUndoNotice, undoLatestThreadAction } from "../hooks/showThreadUndoNotice";
import { registerAppShellCommands } from "./AppSidebarLayout";

// A thread archived from the header opens a new thread and focuses its composer. mod+z
// undoes the archive while a notice for it is on screen, in the full sidebar or as the
// icon column's tile; with the sidebar hidden there is no notice, so the field keeps its undo.
it.each([
  { sidebar: "icon column", state: "expanded", compact: "true", restores: true },
  { sidebar: "full sidebar", state: "expanded", compact: "false", restores: true },
  { sidebar: "hidden sidebar", state: "collapsed", compact: "false", restores: false },
])(
  "mod+z in a focused text field, $sidebar: restores the archived thread: $restores",
  async ({ state, compact, restores }) => {
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
    await using screen = await render(
      <div data-slot="sidebar-wrapper" data-sidebar-state={state} data-sidebar-compact={compact}>
        <main data-testid="shell">
          <textarea aria-label="Composer" />
        </main>
      </div>,
      { router: "/" },
    );
    using _commands = {
      [Symbol.dispose]: registerAppShellCommands(
        screen.router!,
        screen.getByTestId("shell").element(),
      ),
    };
    const restore = vi.fn(() => Promise.resolve(AsyncResult.success(undefined)));
    showThreadUndoNotice({
      action: "Archived",
      failureTitle: "Could not restore the thread",
      undo: restore,
      claim: ThreadUndo.begin("archive", "environment-test/thread-archived"),
    });
    using _notice = { [Symbol.dispose]: () => void undoLatestThreadAction() };
    (screen.getByRole("textbox").element() as HTMLTextAreaElement).focus();

    await userEvent.keyboard("{Control>}z{/Control}");

    expect(restore).toHaveBeenCalledTimes(restores ? 1 : 0);
  },
);
