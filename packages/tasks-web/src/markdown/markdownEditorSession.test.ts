// @vitest-environment jsdom

import { editorViewCtx } from "@milkdown/core";
import type { EditorView } from "@milkdown/prose/view";
import { TextSelection } from "@milkdown/prose/state";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { MarkdownEditorSession } from "./markdownEditorCore.ts";

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

async function open(initial: string) {
  let value = initial;
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
      onOpenLink: () => undefined,
      isEditable: () => true,
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
    onChange,
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
