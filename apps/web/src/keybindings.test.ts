import { assert, describe, it } from "vite-plus/test";

import {
  type KeybindingCommand,
  type KeybindingShortcut,
  type KeybindingWhenNode,
  type ResolvedKeybindingsConfig,
} from "@upcomputer/contracts";
import {
  formatShortcutLabel,
  isChatNewShortcut,
  isChatNewLocalShortcut,
  isDiffToggleShortcut,
  modelPickerJumpCommandForIndex,
  modelPickerJumpIndexFromCommand,
  isOpenFavoriteEditorShortcut,
  resolveShortcutCommand,
  shouldShowModelPickerJumpHints,
  shouldShowThreadJumpHints,
  shortcutLabelForCommand,
  threadJumpCommandForIndex,
  threadJumpIndexFromCommand,
  threadTraversalDirectionFromCommand,
  type ShortcutEventLike,
} from "./keybindings";

function event(overrides: Partial<ShortcutEventLike> = {}): ShortcutEventLike {
  return {
    key: "j",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  };
}

function modShortcut(
  key: string,
  overrides: Partial<Omit<KeybindingShortcut, "key">> = {},
): KeybindingShortcut {
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    modKey: true,
    ...overrides,
  };
}

function whenIdentifier(name: string): KeybindingWhenNode {
  return { type: "identifier", name };
}

function whenNot(node: KeybindingWhenNode): KeybindingWhenNode {
  return { type: "not", node };
}

function whenAnd(left: KeybindingWhenNode, right: KeybindingWhenNode): KeybindingWhenNode {
  return { type: "and", left, right };
}

interface TestBinding {
  shortcut: KeybindingShortcut;
  command: KeybindingCommand;
  whenAst?: KeybindingWhenNode;
}

function compile(bindings: TestBinding[]): ResolvedKeybindingsConfig {
  return bindings.map((binding) => ({
    command: binding.command,
    shortcut: binding.shortcut,
    ...(binding.whenAst ? { whenAst: binding.whenAst } : {}),
  }));
}

const DEFAULT_BINDINGS = compile([
  { shortcut: modShortcut("b"), command: "sidebar.toggle" },
  { shortcut: modShortcut("b", { altKey: true }), command: "rightPanel.toggle" },
  { shortcut: modShortcut("d"), command: "diff.toggle" },
  { shortcut: modShortcut("k"), command: "commandPalette.toggle" },
  { shortcut: modShortcut("m", { shiftKey: true }), command: "modelPicker.toggle" },
  {
    shortcut: modShortcut("r"),
    command: "preview.refresh",
    whenAst: whenIdentifier("previewFocus"),
  },
  { shortcut: modShortcut("o", { shiftKey: true }), command: "chat.new" },
  { shortcut: modShortcut("n", { shiftKey: true }), command: "chat.newLocal" },
  { shortcut: modShortcut("o"), command: "editor.openFavorite" },
  { shortcut: modShortcut("[", { shiftKey: true }), command: "thread.previous" },
  { shortcut: modShortcut("]", { shiftKey: true }), command: "thread.next" },
  { shortcut: modShortcut("1"), command: "thread.jump.1" },
  { shortcut: modShortcut("2"), command: "thread.jump.2" },
  { shortcut: modShortcut("3"), command: "thread.jump.3" },
  {
    shortcut: modShortcut("1"),
    command: "modelPicker.jump.1",
    whenAst: whenIdentifier("modelPickerOpen"),
  },
  {
    shortcut: modShortcut("2"),
    command: "modelPicker.jump.2",
    whenAst: whenIdentifier("modelPickerOpen"),
  },
  {
    shortcut: modShortcut("3"),
    command: "modelPicker.jump.3",
    whenAst: whenIdentifier("modelPickerOpen"),
  },
]);

describe("when clauses", () => {
  it("supports when expressions", () => {
    const keybindings = compile([
      {
        shortcut: modShortcut("\\"),
        command: "preview.refresh",
        whenAst: whenAnd(whenIdentifier("previewOpen"), whenNot(whenIdentifier("previewFocus"))),
      },
    ]);
    assert.strictEqual(
      resolveShortcutCommand(event({ key: "\\", ctrlKey: true }), keybindings, {
        platform: "Win32",
        context: { previewOpen: true, previewFocus: false },
      }),
      "preview.refresh",
    );
    assert.isNull(
      resolveShortcutCommand(event({ key: "\\", ctrlKey: true }), keybindings, {
        platform: "Win32",
        context: { previewOpen: false, previewFocus: false },
      }),
    );
  });

  it("supports when boolean literals", () => {
    const keybindings = compile([
      { shortcut: modShortcut("n"), command: "chat.new", whenAst: whenIdentifier("true") },
      { shortcut: modShortcut("m"), command: "chat.new", whenAst: whenIdentifier("false") },
    ]);

    assert.isTrue(
      isChatNewShortcut(event({ key: "n", ctrlKey: true }), keybindings, { platform: "Linux" }),
    );
    assert.isFalse(
      isChatNewShortcut(event({ key: "m", ctrlKey: true }), keybindings, { platform: "Linux" }),
    );
  });

  it("treats unknown identifiers from removed features as false", () => {
    const keybindings = compile([
      {
        shortcut: modShortcut("d"),
        command: "diff.toggle",
        whenAst: whenNot(whenIdentifier("terminalFocus")),
      },
      {
        shortcut: modShortcut("k"),
        command: "commandPalette.toggle",
        whenAst: whenIdentifier("terminalFocus"),
      },
    ]);

    assert.isTrue(
      isDiffToggleShortcut(event({ key: "d", metaKey: true }), keybindings, {
        platform: "MacIntel",
      }),
    );
    assert.isNull(
      resolveShortcutCommand(event({ key: "k", metaKey: true }), keybindings, {
        platform: "MacIntel",
      }),
    );
  });
});

describe("shortcutLabelForCommand", () => {
  it("returns the effective binding label", () => {
    const bindings = compile([
      {
        shortcut: modShortcut("\\"),
        command: "preview.refresh",
        whenAst: whenIdentifier("previewFocus"),
      },
      {
        shortcut: modShortcut("\\", { shiftKey: true }),
        command: "preview.refresh",
        whenAst: whenNot(whenIdentifier("previewFocus")),
      },
    ]);
    assert.strictEqual(
      shortcutLabelForCommand(bindings, "preview.refresh", {
        platform: "Linux",
        context: { previewFocus: false },
      }),
      "Ctrl+Shift+\\",
    );
  });

  it("returns effective labels for default commands", () => {
    assert.strictEqual(
      shortcutLabelForCommand(DEFAULT_BINDINGS, "sidebar.toggle", "MacIntel"),
      "⌘B",
    );
    assert.strictEqual(shortcutLabelForCommand(DEFAULT_BINDINGS, "chat.new", "MacIntel"), "⇧⌘O");
    assert.strictEqual(shortcutLabelForCommand(DEFAULT_BINDINGS, "diff.toggle", "Linux"), "Ctrl+D");
    assert.strictEqual(
      shortcutLabelForCommand(DEFAULT_BINDINGS, "rightPanel.toggle", "MacIntel"),
      "⌥⌘B",
    );
    assert.strictEqual(
      shortcutLabelForCommand(DEFAULT_BINDINGS, "commandPalette.toggle", "MacIntel"),
      "⌘K",
    );
    assert.strictEqual(
      shortcutLabelForCommand(DEFAULT_BINDINGS, "modelPicker.toggle", "Linux"),
      "Ctrl+Shift+M",
    );
    assert.strictEqual(
      shortcutLabelForCommand(DEFAULT_BINDINGS, "editor.openFavorite", "Linux"),
      "Ctrl+O",
    );
    assert.strictEqual(
      shortcutLabelForCommand(DEFAULT_BINDINGS, "thread.jump.3", "MacIntel"),
      "⌘3",
    );
    assert.strictEqual(
      shortcutLabelForCommand(DEFAULT_BINDINGS, "thread.previous", "Linux"),
      "Ctrl+Shift+[",
    );
    assert.strictEqual(
      shortcutLabelForCommand(DEFAULT_BINDINGS, "modelPicker.jump.3", {
        platform: "MacIntel",
        context: { modelPickerOpen: true },
      }),
      "⌘3",
    );
  });

  it("returns null for commands shadowed by a later conflicting shortcut", () => {
    const bindings = compile([
      { shortcut: modShortcut("1", { shiftKey: true }), command: "thread.jump.1" },
      { shortcut: modShortcut("1", { shiftKey: true }), command: "thread.jump.7" },
    ]);

    assert.isNull(shortcutLabelForCommand(bindings, "thread.jump.1", "MacIntel"));
    assert.strictEqual(shortcutLabelForCommand(bindings, "thread.jump.7", "MacIntel"), "⇧⌘1");
  });

  it("respects when-context while resolving labels", () => {
    const bindings = compile([
      { shortcut: modShortcut("d"), command: "diff.toggle" },
      {
        shortcut: modShortcut("d"),
        command: "preview.refresh",
        whenAst: whenIdentifier("previewFocus"),
      },
    ]);

    assert.strictEqual(
      shortcutLabelForCommand(bindings, "diff.toggle", {
        platform: "Linux",
        context: { previewFocus: false },
      }),
      "Ctrl+D",
    );
    assert.isNull(
      shortcutLabelForCommand(bindings, "diff.toggle", {
        platform: "Linux",
        context: { previewFocus: true },
      }),
    );
    assert.strictEqual(
      shortcutLabelForCommand(bindings, "preview.refresh", {
        platform: "Linux",
        context: { previewFocus: true },
      }),
      "Ctrl+D",
    );
  });
});

describe("thread navigation helpers", () => {
  it("maps jump commands to visible thread indices", () => {
    assert.strictEqual(threadJumpCommandForIndex(0), "thread.jump.1");
    assert.strictEqual(threadJumpCommandForIndex(2), "thread.jump.3");
    assert.isNull(threadJumpCommandForIndex(9));
    assert.strictEqual(threadJumpIndexFromCommand("thread.jump.1"), 0);
    assert.strictEqual(threadJumpIndexFromCommand("thread.jump.3"), 2);
    assert.isNull(threadJumpIndexFromCommand("thread.next"));
  });

  it("maps traversal commands to directions", () => {
    assert.strictEqual(threadTraversalDirectionFromCommand("thread.previous"), "previous");
    assert.strictEqual(threadTraversalDirectionFromCommand("thread.next"), "next");
    assert.isNull(threadTraversalDirectionFromCommand("thread.jump.1"));
    assert.isNull(threadTraversalDirectionFromCommand(null));
  });

  it("shows jump hints only when configured modifiers match", () => {
    assert.isTrue(
      shouldShowThreadJumpHints(event({ metaKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
      }),
    );
    assert.isFalse(
      shouldShowThreadJumpHints(event({ metaKey: true, shiftKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
      }),
    );
    assert.isTrue(
      shouldShowThreadJumpHints(event({ ctrlKey: true }), DEFAULT_BINDINGS, {
        platform: "Linux",
      }),
    );
  });
});

describe("model picker navigation helpers", () => {
  it("maps jump commands to visible model indices", () => {
    assert.strictEqual(modelPickerJumpCommandForIndex(0), "modelPicker.jump.1");
    assert.strictEqual(modelPickerJumpCommandForIndex(2), "modelPicker.jump.3");
    assert.isNull(modelPickerJumpCommandForIndex(9));
    assert.strictEqual(modelPickerJumpIndexFromCommand("modelPicker.jump.1"), 0);
    assert.strictEqual(modelPickerJumpIndexFromCommand("modelPicker.jump.3"), 2);
    assert.isNull(modelPickerJumpIndexFromCommand("thread.jump.1"));
  });

  it("shows jump hints only while the model picker context is active", () => {
    assert.isFalse(
      shouldShowModelPickerJumpHints(event({ metaKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
        context: { modelPickerOpen: false },
      }),
    );
    assert.isTrue(
      shouldShowModelPickerJumpHints(event({ metaKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
        context: { modelPickerOpen: true },
      }),
    );
  });
});

describe("chat/editor shortcuts", () => {
  it("matches chat.new shortcut", () => {
    assert.isTrue(
      isChatNewShortcut(event({ key: "o", metaKey: true, shiftKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
      }),
    );
    assert.isTrue(
      isChatNewShortcut(event({ key: "o", ctrlKey: true, shiftKey: true }), DEFAULT_BINDINGS, {
        platform: "Linux",
      }),
    );
  });

  it("matches chat.newLocal shortcut", () => {
    assert.isTrue(
      isChatNewLocalShortcut(event({ key: "n", metaKey: true, shiftKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
      }),
    );
    assert.isTrue(
      isChatNewLocalShortcut(event({ key: "n", ctrlKey: true, shiftKey: true }), DEFAULT_BINDINGS, {
        platform: "Linux",
      }),
    );
  });

  it("matches editor.openFavorite shortcut", () => {
    assert.isTrue(
      isOpenFavoriteEditorShortcut(event({ key: "o", metaKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
      }),
    );
    assert.isTrue(
      isOpenFavoriteEditorShortcut(event({ key: "o", ctrlKey: true }), DEFAULT_BINDINGS, {
        platform: "Linux",
      }),
    );
  });

  it("matches commandPalette.toggle shortcut", () => {
    assert.strictEqual(
      resolveShortcutCommand(event({ key: "k", metaKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
      }),
      "commandPalette.toggle",
    );
  });

  it("matches diff.toggle shortcut", () => {
    assert.isTrue(
      isDiffToggleShortcut(event({ key: "d", metaKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
      }),
    );
  });
});

describe("cross-command precedence", () => {
  it("uses when + order so a later focused rule overrides a global rule", () => {
    const keybindings = compile([
      { shortcut: modShortcut("n"), command: "chat.new" },
      {
        shortcut: modShortcut("n"),
        command: "preview.refresh",
        whenAst: whenIdentifier("previewFocus"),
      },
    ]);

    assert.isTrue(
      resolveShortcutCommand(event({ key: "n", metaKey: true }), keybindings, {
        platform: "MacIntel",
        context: { previewFocus: true },
      }) === "preview.refresh",
    );
    assert.isFalse(
      isChatNewShortcut(event({ key: "n", metaKey: true }), keybindings, {
        platform: "MacIntel",
        context: { previewFocus: true },
      }),
    );
    assert.isFalse(
      resolveShortcutCommand(event({ key: "n", metaKey: true }), keybindings, {
        platform: "MacIntel",
        context: { previewFocus: false },
      }) === "preview.refresh",
    );
    assert.isTrue(
      isChatNewShortcut(event({ key: "n", metaKey: true }), keybindings, {
        platform: "MacIntel",
        context: { previewFocus: false },
      }),
    );
  });

  it("still lets a later global rule win when both rules match", () => {
    const keybindings = compile([
      {
        shortcut: modShortcut("n"),
        command: "preview.refresh",
        whenAst: whenIdentifier("previewFocus"),
      },
      { shortcut: modShortcut("n"), command: "chat.new" },
    ]);

    assert.isFalse(
      resolveShortcutCommand(event({ key: "n", ctrlKey: true }), keybindings, {
        platform: "Linux",
        context: { previewFocus: true },
      }) === "preview.refresh",
    );
    assert.isTrue(
      isChatNewShortcut(event({ key: "n", ctrlKey: true }), keybindings, {
        platform: "Linux",
        context: { previewFocus: true },
      }),
    );
  });
});

describe("resolveShortcutCommand", () => {
  it("returns dynamic script commands", () => {
    const keybindings = compile([{ shortcut: modShortcut("r"), command: "script.setup.run" }]);

    assert.strictEqual(
      resolveShortcutCommand(event({ key: "r", ctrlKey: true }), keybindings, {
        platform: "Linux",
      }),
      "script.setup.run",
    );
  });

  it("matches bracket shortcuts using the physical key code", () => {
    assert.strictEqual(
      resolveShortcutCommand(
        event({ key: "{", code: "BracketLeft", metaKey: true, shiftKey: true }),
        DEFAULT_BINDINGS,
        {
          platform: "MacIntel",
        },
      ),
      "thread.previous",
    );
    assert.strictEqual(
      resolveShortcutCommand(
        event({ key: "}", code: "BracketRight", ctrlKey: true, shiftKey: true }),
        DEFAULT_BINDINGS,
        {
          platform: "Linux",
        },
      ),
      "thread.next",
    );
  });

  it("matches Option-modified letters using the physical key code on macOS", () => {
    assert.strictEqual(
      resolveShortcutCommand(
        event({ key: "∫", code: "KeyB", metaKey: true, altKey: true }),
        DEFAULT_BINDINGS,
        { platform: "MacIntel" },
      ),
      "rightPanel.toggle",
    );
  });
});

describe("formatShortcutLabel", () => {
  it("formats labels for macOS", () => {
    assert.strictEqual(
      formatShortcutLabel(modShortcut("d", { shiftKey: true }), "MacIntel"),
      "⇧⌘D",
    );
  });

  it("formats labels for non-macOS", () => {
    assert.strictEqual(
      formatShortcutLabel(modShortcut("d", { shiftKey: true }), "Linux"),
      "Ctrl+Shift+D",
    );
  });

  it("formats labels for plus key", () => {
    assert.strictEqual(formatShortcutLabel(modShortcut("+"), "MacIntel"), "⌘+");
    assert.strictEqual(formatShortcutLabel(modShortcut("+"), "Linux"), "Ctrl++");
  });
});

describe("plus key parsing", () => {
  it("matches the plus key shortcut", () => {
    const plusBindings = compile([{ shortcut: modShortcut("+"), command: "sidebar.toggle" }]);
    assert.strictEqual(
      resolveShortcutCommand(event({ key: "+", metaKey: true }), plusBindings, {
        platform: "MacIntel",
      }),
      "sidebar.toggle",
    );
    assert.strictEqual(
      resolveShortcutCommand(event({ key: "+", ctrlKey: true }), plusBindings, {
        platform: "Linux",
      }),
      "sidebar.toggle",
    );
  });
});
