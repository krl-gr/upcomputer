import * as NodeVM from "node:vm";

import { describe, expect, it, vi } from "vite-plus/test";

import { sendPageCommand } from "./GuestInput.ts";

/** An unfocused guest whose page applies the native edit only when `applies` is set. */
const makeUnfocusedGuest = ({
  value,
  caret,
  applies,
  prevents = false,
  arrives = "now",
}: {
  readonly value: string;
  readonly caret: number;
  readonly applies: boolean;
  readonly prevents?: boolean | undefined;
  readonly arrives?: "now" | "late" | "never" | undefined;
}) => {
  const listeners = new Map<string, Set<(event: object) => void>>();
  const dispatch = (type: string) => {
    const event = {
      type,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    for (const listener of listeners.get(type) ?? []) listener(event);
    return event;
  };
  const document = {
    activeElement: null as object | null,
    defaultView: { getComputedStyle: () => ({ direction: "ltr" }) },
    addEventListener: (type: string, listener: (event: object) => void) => {
      listeners.set(type, (listeners.get(type) ?? new Set()).add(listener));
    },
    removeEventListener: (type: string, listener: (event: object) => void) => {
      listeners.get(type)?.delete(listener);
    },
  };
  const field = {
    tagName: "TEXTAREA",
    value,
    selectionStart: caret,
    selectionEnd: caret,
    disabled: false,
    readOnly: false,
    isConnected: true,
    getRootNode: () => document,
  };
  document.activeElement = field;
  if (prevents) document.addEventListener("keydown", (event) => (event as Event).preventDefault());
  let lateKey: (() => void) | undefined;
  const context = NodeVM.createContext({
    document,
    // A late key lands while the check waits for it; a lost key lets that wait end at once.
    setTimeout: (callback: () => void, ms: number) => {
      if (ms > 0 && lateKey) return lateKey();
      setImmediate(callback);
    },
  });
  const applyKey = (event: Electron.KeyboardInputEvent) => {
    if (dispatch("keydown").defaultPrevented || !applies) return;
    const at = event.keyCode === "Backspace" ? field.selectionStart - 1 : field.selectionStart;
    field.value = field.value.slice(0, at) + field.value.slice(at + 1);
    field.selectionStart = field.selectionEnd = at;
    dispatch("input");
  };
  const sendInputEvent = vi.fn((event: Electron.KeyboardInputEvent) => {
    if (event.type !== "rawKeyDown" || arrives === "never") return;
    if (arrives === "now") applyKey(event);
    else lateKey = () => applyKey(event);
  });
  const debuggee = {
    sendCommand: async (method: string, params: { expression: string }) => {
      if (method !== "Runtime.evaluate") throw new Error(`${method} needs focus`);
      return { result: { value: await NodeVM.runInContext(params.expression, context) } };
    },
  };
  return {
    field,
    sendInputEvent,
    listeners,
    press: (key: string) =>
      sendPageCommand(
        { focusedFrame: null, sendInputEvent } as unknown as Electron.WebContents,
        debuggee as unknown as Electron.Debugger,
        "Input.dispatchKeyEvent",
        { type: "rawKeyDown", key, modifiers: 0 },
      ),
  };
};

describe("unfocused guest key effect", () => {
  // regression: Backspace with no native focus reported success and left the textarea unchanged
  it.each([
    { name: "the page skipped its edit", arrives: "now" as const },
    { name: "it never reached the page", arrives: "never" as const },
  ])("fails a Backspace when $name and still releases the key", async ({ arrives }) => {
    const guest = makeUnfocusedGuest({ value: "hello", caret: 5, applies: false, arrives });
    await expect(guest.press("Backspace")).rejects.toThrow(/the key had no effect/i);
    expect(guest.field.value).toBe("hello");
    expect(guest.sendInputEvent).toHaveBeenLastCalledWith({
      type: "keyUp",
      keyCode: "Backspace",
      modifiers: [],
    });
  });

  it.each([
    { name: "an applied Backspace", key: "Backspace", caret: 5, applies: true },
    {
      name: "a Backspace the page gets late",
      key: "Backspace",
      caret: 5,
      applies: true,
      late: true,
    },
    { name: "Backspace at the start", key: "Backspace", caret: 0, applies: false },
    { name: "Delete at the end", key: "Delete", caret: 5, applies: false },
    { name: "a key the page took", key: "Backspace", caret: 5, applies: false, prevents: true },
    { name: "a key with no readable effect", key: "Enter", caret: 5, applies: false },
  ])("passes $name", async ({ key, caret, applies, prevents, late }) => {
    const guest = makeUnfocusedGuest({
      value: "hello",
      caret,
      applies,
      prevents,
      arrives: late ? "late" : "now",
    });
    await expect(guest.press(key)).resolves.toEqual({});
    // The probe removes its listeners, leaving only the page's own.
    expect([...guest.listeners.values()].reduce((count, set) => count + set.size, 0)).toBe(
      prevents ? 1 : 0,
    );
  });
});
