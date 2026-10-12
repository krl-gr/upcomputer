import {
  Editor,
  commandsCtx,
  defaultValueCtx,
  editorViewCtx,
  editorViewOptionsCtx,
  parserCtx,
  prosePluginsCtx,
  rootCtx,
  serializerCtx,
} from "@milkdown/core";
import type { Ctx } from "@milkdown/ctx";
import { block } from "@milkdown/plugin-block";
import { clipboard } from "@milkdown/plugin-clipboard";
import { history } from "@milkdown/plugin-history";
import { trailing } from "@milkdown/plugin-trailing";
import {
  addBlockTypeCommand,
  createCodeBlockCommand,
  turnIntoTextCommand,
  wrapInBlockTypeCommand,
  wrapInBlockquoteCommand,
  wrapInHeadingCommand,
} from "@milkdown/preset-commonmark";
import { insertTableCommand } from "@milkdown/preset-gfm";
import { EditorState, Plugin, PluginKey, TextSelection } from "@milkdown/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/prose/view";

import { configureMarkdownFormat, markdownPresets } from "./markdownFormat.ts";

/** An open `/` menu: where it shows and the text typed after the slash. */
export interface SlashMenuState {
  readonly left: number;
  readonly top: number;
  readonly query: string;
  /** The `/query` text the chosen command replaces; empty for the block handle's "+". */
  readonly from: number;
  readonly to: number;
}

export interface MarkdownEditorHooks {
  /** The document changed: typed, pasted, toggled, or replaced from outside. */
  readonly onDocChanged: () => void;
  readonly onFocusChange: (focused: boolean) => void;
  /** The `/` menu opened, moved or closed (null). */
  readonly onSlashMenu: (menu: SlashMenuState | null) => void;
  /** Every key first; true when the `/` menu used it. */
  readonly onKey: (event: KeyboardEvent) => boolean;
  readonly onOpenLink: (href: string) => void;
  readonly isEditable: () => boolean;
  readonly placeholder: () => string;
  readonly ariaLabel: () => string;
}

/** Wande's task checkbox toggle: a click in the left gutter of a task item. */
function taskToggleClick(view: EditorView, event: MouseEvent): boolean {
  if (!(event.target instanceof HTMLElement) || !view.editable) return false;
  const item = event.target.closest<HTMLLIElement>('li[data-item-type="task"]');
  if (!item || event.clientX > item.getBoundingClientRect().left + 30) return false;
  const $pos = view.state.doc.resolve(
    Math.min(view.posAtDOM(item, 0), view.state.doc.content.size),
  );
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth);
    if (node.type.name === "list_item" && node.attrs.checked != null) {
      view.dispatch(
        view.state.tr.setNodeMarkup($pos.before(depth), undefined, {
          ...node.attrs,
          checked: !node.attrs.checked,
        }),
      );
      event.preventDefault();
      return true;
    }
  }
  return false;
}

/** The `/query` before the cursor in a text block, as in wande. */
function slashMenuAt(view: EditorView): SlashMenuState | null {
  const { selection } = view.state;
  if (!selection.empty || !view.hasFocus()) return null;
  const { $from, from } = selection;
  if (!$from.parent.isTextblock || $from.parent.type.name === "code_block") return null;
  const before = $from.parent.textBetween(0, $from.parentOffset, "\0", "\0");
  const match = /(?:^|\s)\/([^\s/]*)$/.exec(before);
  if (!match) return null;
  const query = match[1] ?? "";
  const coords = view.coordsAtPos(from);
  return {
    left: coords.left,
    top: coords.bottom + 6,
    query,
    from: from - query.length - 1,
    to: from,
  };
}

function sameMenu(left: SlashMenuState | null, right: SlashMenuState | null) {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.query === right.query &&
      left.from === right.from &&
      left.left === right.left &&
      left.top === right.top)
  );
}

function editorPlugin(hooks: MarkdownEditorHooks) {
  let menu: SlashMenuState | null = null;
  const reportMenu = (view: EditorView) => {
    const next = slashMenuAt(view);
    if (sameMenu(menu, next)) return;
    menu = next;
    hooks.onSlashMenu(next);
  };
  return new Plugin({
    key: new PluginKey("upcomputer-markdown-editor"),
    view: () => ({
      update: (view, previous) => {
        if (!previous.doc.eq(view.state.doc)) hooks.onDocChanged();
        reportMenu(view);
      },
    }),
    props: {
      handleKeyDown: (view, event) => {
        if (hooks.onKey(event)) return true;
        // Escape leaves the field like any input, and still reaches the window.
        if (event.key === "Escape") view.dom.blur();
        return false;
      },
      handleDOMEvents: {
        mousedown: taskToggleClick,
        focus: (view) => {
          hooks.onFocusChange(true);
          reportMenu(view);
          return false;
        },
        blur: (view) => {
          hooks.onFocusChange(false);
          reportMenu(view);
          return false;
        },
      },
      // Cmd+click (Ctrl+click) opens a link; a plain click edits it.
      handleClick: (_view, _pos, event) => {
        if (!(event.metaKey || event.ctrlKey) || !(event.target instanceof Element)) return false;
        const href = event.target.closest("a")?.getAttribute("href");
        if (!href || !/^(https?:|mailto:)/i.test(href)) return false;
        event.preventDefault();
        hooks.onOpenLink(href);
        return true;
      },
      decorations: (state) => {
        const { doc } = state;
        const first = doc.firstChild;
        if (doc.childCount !== 1 || !first?.isTextblock || first.content.size > 0) return null;
        return DecorationSet.create(doc, [
          Decoration.node(0, first.nodeSize, {
            class: "markdown-editor-placeholder",
            "data-placeholder": hooks.placeholder(),
          }),
        ]);
      },
    },
  });
}

/**
 * A Milkdown editor over `value` (wande's MilkdownMarkdownEditor): CommonMark
 * and GFM with undo, paste, the block handle and trailing paragraph. `configure`
 * adds what needs the view's owner, like the block handle.
 */
function createMarkdownEditor(
  root: HTMLElement,
  value: string,
  hooks: MarkdownEditorHooks,
  configure: (ctx: Ctx) => void,
) {
  return Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, value);
      ctx.update(editorViewOptionsCtx, (options) => ({
        ...options,
        editable: hooks.isEditable,
        attributes: () => ({
          class: "chat-markdown markdown-editor-content",
          role: "textbox",
          "aria-multiline": "true",
          "aria-label": hooks.ariaLabel(),
        }),
      }));
      ctx.update(prosePluginsCtx, (plugins) => [...plugins, editorPlugin(hooks)]);
      configureMarkdownFormat(ctx);
      configure(ctx);
    })
    .use(markdownPresets)
    .use(history)
    .use(clipboard)
    .use(trailing)
    .use(block);
}

// Stored texts have no final newline; remark-stringify always adds one.
const withoutFinalNewline = (markdown: string) => markdown.replace(/\n$/, "");

function serializeMarkdown(editor: Editor): string {
  return editor.action((ctx) =>
    withoutFinalNewline(ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc)),
  );
}

/**
 * Shows `value` as a fresh document: no undo back into the old text. Returns
 * the markdown the editor writes for it, which can differ in formatting.
 */
function replaceMarkdown(editor: Editor, value: string): string {
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const doc = ctx.get(parserCtx)(value);
    view.updateState(
      EditorState.create({ schema: view.state.schema, doc, plugins: view.state.plugins }),
    );
    return withoutFinalNewline(ctx.get(serializerCtx)(doc));
  });
}

function focusEditor(editor: Editor) {
  editor.action((ctx) => ctx.get(editorViewCtx).focus());
}

/** Rechecks `editable`, the label and the placeholder after the owner's props changed. */
export function refreshView(editor: Editor) {
  editor.action((ctx) => ctx.get(editorViewCtx).setProps({}));
}

export type SlashCommandId =
  | "text"
  | "h1"
  | "h2"
  | "h3"
  | "bullet"
  | "ordered"
  | "task"
  | "quote"
  | "divider"
  | "table"
  | "code";

function runSlashCommand(ctx: Ctx, id: SlashCommandId) {
  const commands = ctx.get(commandsCtx);
  const nodes = ctx.get(editorViewCtx).state.schema.nodes;
  switch (id) {
    case "text":
      return commands.call(turnIntoTextCommand.key);
    case "h1":
    case "h2":
    case "h3":
      return commands.call(wrapInHeadingCommand.key, Number(id.slice(1)));
    case "bullet":
      return commands.call(wrapInBlockTypeCommand.key, { nodeType: nodes.bullet_list });
    case "ordered":
      return commands.call(wrapInBlockTypeCommand.key, { nodeType: nodes.ordered_list });
    case "task":
      return commands.call(wrapInBlockTypeCommand.key, {
        nodeType: nodes.list_item,
        attrs: { checked: false },
      });
    case "quote":
      return commands.call(wrapInBlockquoteCommand.key);
    case "divider":
      return commands.call(addBlockTypeCommand.key, { nodeType: nodes.hr });
    case "table":
      return commands.call(insertTableCommand.key, { row: 3, col: 3 });
    case "code":
      return commands.call(createCodeBlockCommand.key);
  }
}

/**
 * Runs a `/` menu command: drops the typed `/query`, or for the block handle's
 * "+" first adds an empty paragraph below the block, then turns the cursor's
 * block into the chosen one.
 */
export function applySlashCommand(
  editor: Editor,
  menu: SlashMenuState,
  id: SlashCommandId,
  insertBelow: boolean,
) {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const { state } = view;
    if (insertBelow) {
      const pos = Math.min(Math.max(0, menu.from), state.doc.content.size);
      const tr = state.tr.insert(pos, state.schema.nodes.paragraph!.create());
      view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1))));
    } else {
      view.dispatch(state.tr.delete(menu.from, menu.to));
    }
    runSlashCommand(ctx, id);
    view.focus();
  });
}

export interface MarkdownSessionHooks extends Omit<
  MarkdownEditorHooks,
  "onDocChanged" | "onFocusChange"
> {
  /** The owner's current text. */
  readonly value: () => string;
  readonly onChange: (value: string) => void;
  /** The person changed the document (not an outside value). */
  readonly onEdit: () => void;
  readonly onBlur: () => void;
}

/**
 * One editor kept in step with its owner's value. `onChange` reports edits
 * only; an edit that returns the text to how it loaded reports the original
 * value, not Milkdown's reformatting of it, so opening, clicking or undoing
 * never rewrites a description. A new outside value (an agent's update) shows
 * at once while the field is not focused. While it is focused the person's
 * text wins: an edited field reports its text again on blur, an unedited one
 * takes the new value then. To discard edits on purpose, remount the editor.
 */
export class MarkdownEditorSession {
  readonly editor: Editor;
  readonly ready: Promise<void>;
  readonly #hooks: MarkdownSessionHooks;
  // `raw` is the value the editor loaded, `normalized` how Milkdown writes it,
  // `reported` the value the owner has from or gave to the editor.
  #raw: string;
  #normalized: string | null = null;
  #reported: string;
  #applying = false;
  #focused = false;
  #destroyed = false;

  constructor(
    root: HTMLElement,
    hooks: MarkdownSessionHooks,
    configure: (ctx: Ctx) => void,
    autoFocus = false,
  ) {
    this.#hooks = hooks;
    this.#raw = hooks.value();
    this.#reported = this.#raw;
    this.editor = createMarkdownEditor(
      root,
      this.#raw,
      {
        ...hooks,
        onDocChanged: () => {
          if (this.#applying) return;
          hooks.onEdit();
          this.#report();
        },
        onFocusChange: (focused) => {
          this.#focused = focused;
          if (focused) return;
          // Text the person edited stays over a value that arrived meanwhile.
          if (this.#reported !== this.#raw && this.#hooks.value() !== this.#reported)
            hooks.onChange(this.#reported);
          else this.valueChanged();
          hooks.onBlur();
        },
      },
      configure,
    );
    this.ready = this.editor.create().then(() => {
      if (this.#destroyed) return;
      this.#normalized = serializeMarkdown(this.editor);
      // The owner's value may have changed while Milkdown loaded.
      this.valueChanged();
      if (autoFocus) focusEditor(this.editor);
    });
  }

  /** Call when the owner's value may have changed. */
  valueChanged() {
    const value = this.#hooks.value();
    if (this.#normalized === null || this.#focused || value === this.#reported) return;
    this.#applying = true;
    try {
      this.#normalized = replaceMarkdown(this.editor, value);
    } finally {
      this.#applying = false;
    }
    this.#raw = value;
    this.#reported = value;
  }

  destroy() {
    this.#destroyed = true;
    this.#normalized = null;
    void this.ready.then(() => this.editor.destroy()).catch(() => undefined);
  }

  #report() {
    if (this.#normalized === null) return;
    const markdown = serializeMarkdown(this.editor);
    // Only trailing whitespace differs when the editor adds an empty last paragraph.
    const next = markdown.trimEnd() === this.#normalized.trimEnd() ? this.#raw : markdown;
    if (next === this.#reported) return;
    this.#reported = next;
    this.#hooks.onChange(next);
  }
}
