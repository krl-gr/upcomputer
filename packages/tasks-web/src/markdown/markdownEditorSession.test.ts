// @vitest-environment jsdom

import { editorViewCtx } from "@milkdown/core";
import { DOMParser } from "@milkdown/prose/model";
import type { EditorView } from "@milkdown/prose/view";
import { TextSelection } from "@milkdown/prose/state";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { MarkdownEditorSession } from "./markdownEditorCore.ts";
import { safeLinkHref } from "./markdownFormat.ts";

// Agents' style the editor should keep: `*` bullets would come back as `-`.
const AGENT_TEXT = [
  "Intro with a file_name.ts path.",
  "",
  "* first",
  "* second",
  "",
  "| a | b |",
  "| - | - |",
  "| 1 | 2 |",
].join("\n");

const sessions: MarkdownEditorSession[] = [];

async function open(initial: string, options: { readonly editable?: boolean } = {}) {
  let value = initial;
  const onOpenLink = vi.fn<(href: string) => void>();
  const onChange = vi.fn((next: string) => {
    value = next;
  });
  const root = document.createElement("div");
  document.body.append(root);
  const session = new MarkdownEditorSession(
    root,
    {
      value: () => value,
      onChange,
      onEdit: () => undefined,
      onBlur: () => undefined,
      onSlashMenu: () => undefined,
      onKey: () => false,
      onOpenLink,
      isEditable: () => options.editable ?? true,
      placeholder: () => "",
      ariaLabel: () => "Description",
    },
    () => undefined,
  );
  sessions.push(session);
  await session.ready;
  const view: EditorView = session.editor.action((ctx) => ctx.get(editorViewCtx));
  return {
    session,
    view,
    root,
    onChange,
    onOpenLink,
    setValue: (next: string) => {
      value = next;
      session.valueChanged();
    },
    text: () => view.state.doc.textContent,
    focus: () => view.dom.dispatchEvent(new FocusEvent("focus")),
    blur: () => view.dom.dispatchEvent(new FocusEvent("blur")),
    typeAtEnd: (text: string) => {
      const end = TextSelection.atEnd(view.state.doc);
      view.dispatch(view.state.tr.setSelection(end).insertText(text));
    },
  };
}

afterEach(() => {
  for (const session of sessions.splice(0)) session.destroy();
  document.body.replaceChildren();
});

describe("MarkdownEditorSession", () => {
  it("reports nothing for opening, focusing, clicking and closing without edits", async () => {
    const editor = await open(AGENT_TEXT);
    editor.focus();
    // A click moves the selection; the trailing paragraph plugin answers it
    // by adding an empty paragraph after the table.
    editor.view.dispatch(
      editor.view.state.tr.setSelection(TextSelection.atStart(editor.view.state.doc)),
    );
    editor.blur();
    editor.session.destroy();
    expect(editor.onChange).not.toHaveBeenCalled();
  });

  it("reports an edit, and the original text verbatim once the edit is undone", async () => {
    const editor = await open(AGENT_TEXT);
    editor.typeAtEnd("x");
    expect(editor.onChange).toHaveBeenCalledTimes(1);
    const edited = editor.onChange.mock.calls[0]![0];
    expect(edited).toContain("- first\n- second");
    expect(edited).toContain("file_name.ts");
    expect(edited).toContain("2x");

    const { state } = editor.view;
    editor.view.dispatch(state.tr.delete(state.selection.from - 1, state.selection.from));
    expect(editor.onChange).toHaveBeenLastCalledWith(AGENT_TEXT);
  });

  it("hands the last edit to the owner before the editor closes", async () => {
    const editor = await open("Draft");
    editor.typeAtEnd(" done");
    editor.session.destroy();
    expect(editor.onChange).toHaveBeenLastCalledWith("Draft done");
  });

  it("shows an outside value at once while the field is not focused", async () => {
    const editor = await open("Old text");
    editor.setValue("Agent text");
    expect(editor.text()).toBe("Agent text");
    expect(editor.onChange).not.toHaveBeenCalled();
  });

  it("keeps the person's typing over an outside value while focused", async () => {
    const editor = await open("Old text");
    editor.focus();
    editor.typeAtEnd(" mine");
    editor.setValue("Agent text");
    expect(editor.text()).toBe("Old text mine");
    editor.blur();
    expect(editor.text()).toBe("Old text mine");
    expect(editor.onChange).toHaveBeenLastCalledWith("Old text mine");
  });

  it("gives an unedited focused field the outside value on blur", async () => {
    const editor = await open("Old text");
    editor.focus();
    editor.setValue("Agent text");
    expect(editor.text()).toBe("Old text");
    editor.blur();
    expect(editor.text()).toBe("Agent text");
    expect(editor.onChange).not.toHaveBeenCalled();
  });
});

const UNSAFE_LINKS = [
  "[click](javascript:window.__xss=1)",
  "[click](JaVaScRiPt:window.__xss=1)",
  "[click](<\tjavascript:window.__xss=1>)",
  "[click](data:text/html,<script>window.__xss=1</script>)",
  "[click](vbscript:msgbox)",
  "<javascript:window.__xss=1>",
];

describe("links", () => {
  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " javascript:alert(1)",
    "\u0001javascript:alert(1)",
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    "data:text/html,x",
    "vbscript:msgbox",
    "file:///etc/passwd",
  ])("refuses the href %j", (href) => {
    expect(safeLinkHref(href)).toBeNull();
  });

  it.each([
    "https://up.computer",
    "HTTP://up.computer",
    "mailto:a@b.c",
    "#notes",
    "/docs",
    "a/b.md",
  ])("keeps the href %j", (href) => {
    expect(safeLinkHref(href)).toBe(href);
  });

  it.each([true, false])("loads code links as plain text (editable: %s)", async (editable) => {
    for (const markdown of UNSAFE_LINKS) {
      const editor = await open(markdown, { editable });
      expect(editor.root.querySelectorAll("a")).toHaveLength(0);
      expect(editor.text()).not.toBe("");
    }
  });

  it("drops a code link from pasted HTML and never renders one", async () => {
    const editor = await open("");
    const { schema } = editor.view.state;
    const pasted = document.createElement("div");
    pasted.innerHTML =
      '<p><a href=" JaVaScRiPt:window.__xss=1">pasted</a> <a href="https://up.computer">ok</a></p>';
    const doc = DOMParser.fromSchema(schema).parse(pasted);
    // A mark that reached the document some other way still renders without its href.
    const forged = schema.text("forged", [schema.marks.link!.create({ href: "javascript:1" })]);
    const { tr } = editor.view.state;
    editor.view.dispatch(
      tr.replaceWith(0, tr.doc.content.size, doc.content).insert(tr.doc.content.size - 1, forged),
    );

    const hrefs = [...editor.root.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["https://up.computer", null]);
    expect(editor.text()).toContain("pasted");
  });

  it("keeps a click on a link from navigating the app, and opens web links read-only", async () => {
    const editor = await open("[site](https://up.computer) and [notes](#notes)", {
      editable: false,
    });
    const [site, notes] = [...editor.root.querySelectorAll("a")];
    const clickSite = new MouseEvent("click", { bubbles: true, cancelable: true });
    site!.dispatchEvent(clickSite);
    const clickNotes = new MouseEvent("click", { bubbles: true, cancelable: true });
    notes!.dispatchEvent(clickNotes);

    expect(clickSite.defaultPrevented).toBe(true);
    expect(clickNotes.defaultPrevented).toBe(true);
    expect(editor.onOpenLink.mock.calls).toEqual([["https://up.computer"]]);
  });

  it("opens a link only on Cmd+click while editing", async () => {
    const editor = await open("[site](https://up.computer)");
    const link = editor.root.querySelector("a")!;
    const plain = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(true);
    expect(editor.onOpenLink).not.toHaveBeenCalled();

    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }));
    expect(editor.onOpenLink).toHaveBeenCalledWith("https://up.computer");
  });
});
