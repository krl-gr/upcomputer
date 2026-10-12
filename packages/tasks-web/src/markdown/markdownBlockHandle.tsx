import { editorViewCtx } from "@milkdown/core";
import type { Ctx } from "@milkdown/ctx";
import { BlockProvider, block, blockConfig } from "@milkdown/plugin-block";
import { findParent } from "@milkdown/prose";
import type { PluginView } from "@milkdown/prose/state";
import { GripVerticalIcon, PlusIcon } from "lucide-react";
import { createRoot, type Root } from "react-dom/client";

import type { SlashMenuState } from "./markdownEditorCore.ts";

function BlockHandle(props: { readonly onAdd: () => void }) {
  return (
    <div className="flex items-center rounded-md border border-border bg-popover p-0.5 text-muted-foreground shadow-xs">
      <button
        type="button"
        className="flex size-5 items-center justify-center rounded-sm hover:bg-accent hover:text-foreground"
        aria-label="Add a block below"
        onPointerDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.preventDefault();
          props.onAdd();
        }}
      >
        <PlusIcon className="size-3.5" />
      </button>
      <div
        className="flex size-5 cursor-grab items-center justify-center rounded-sm hover:bg-accent hover:text-foreground active:cursor-grabbing"
        aria-hidden
      >
        <GripVerticalIcon className="size-3.5" />
      </div>
    </div>
  );
}

/**
 * Wande's block handle: "+" opens the `/` menu for a new block below, the grip
 * drags the block. It lives on document.body so window and dialog scrolling
 * never clips it.
 */
class BlockHandleView implements PluginView {
  readonly #content = document.createElement("div");
  readonly #root: Root;
  readonly #provider: BlockProvider;
  readonly #ctx: Ctx;
  readonly #onOpenMenu: (menu: SlashMenuState) => void;

  constructor(ctx: Ctx, onOpenMenu: (menu: SlashMenuState) => void) {
    this.#ctx = ctx;
    this.#onOpenMenu = onOpenMenu;
    this.#content.className = "markdown-block-handle";
    this.#root = createRoot(this.#content);
    this.#root.render(<BlockHandle onAdd={this.#add} />);
    this.#provider = new BlockProvider({
      ctx,
      content: this.#content,
      root: document.body,
      getOffset: () => 8,
      floatingUIOptions: { strategy: "fixed" },
      getPlacement: ({ active, blockDom }) => {
        if (active.node.type.name === "heading") return "left";
        const style = window.getComputedStyle(active.el);
        const height =
          active.el.getBoundingClientRect().height -
          (Number.parseInt(style.paddingTop, 10) || 0) -
          (Number.parseInt(style.paddingBottom, 10) || 0);
        return blockDom.getBoundingClientRect().height < height ? "left-start" : "left";
      },
    });
    this.#provider.update();
  }

  update = () => this.#provider.update();

  destroy = () => {
    this.#provider.destroy();
    this.#content.remove();
    // Unmounting a root during the editor's own teardown render warns in React.
    queueMicrotask(() => this.#root.unmount());
  };

  #add = () => {
    const view = this.#ctx.get(editorViewCtx);
    const active = this.#provider.active;
    if (!active) return;
    const pos = active.$pos.pos + active.node.nodeSize;
    const coords = view.coordsAtPos(pos);
    this.#provider.hide();
    view.focus();
    this.#onOpenMenu({ left: coords.left, top: coords.bottom + 6, query: "", from: pos, to: pos });
  };
}

export function configureBlockHandle(ctx: Ctx, onOpenMenu: (menu: SlashMenuState) => void) {
  ctx.set(blockConfig.key, {
    // Inside tables and quotes the handle would move cells or quote lines.
    filterNodes: (pos) =>
      !findParent((node) => ["table", "blockquote"].includes(node.type.name))(pos),
  });
  ctx.set(block.key, { view: () => new BlockHandleView(ctx, onOpenMenu) });
}
