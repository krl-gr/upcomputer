import { describe, expect, it, vi } from "vite-plus/test";

import { sidePanelNavigation } from "./sidePanelNavigation";

function setup(replaceTaken = false) {
  const chat = {
    navigate: vi.fn(),
    dispatch: vi.fn(),
    goBack: vi.fn(),
    setParams: vi.fn(),
    isFocused: () => true,
  };
  const leaves: Array<() => void> = [];
  const handlers = {
    close: vi.fn(),
    leave: vi.fn((then: () => void) => leaves.push(then)),
    replace: vi.fn(() => replaceTaken),
  };
  return { chat, handlers, leaves, tab: sidePanelNavigation(chat, handlers) };
}

describe("side panel tab navigation", () => {
  it("closes the tab on Back instead of popping the chat", () => {
    const { chat, handlers, tab } = setup();
    tab.goBack();
    tab.dispatch({ type: "POP", payload: {} });
    expect(handlers.close).toHaveBeenCalledTimes(2);
    expect(chat.goBack).not.toHaveBeenCalled();
    expect(chat.dispatch).not.toHaveBeenCalled();
  });

  it("leaves the panel before navigating on the chat's stack", () => {
    const { chat, leaves, tab } = setup();
    tab.navigate("ThreadFile", { path: ["a"] });
    expect(chat.navigate).not.toHaveBeenCalled();
    leaves[0]!();
    expect(chat.navigate).toHaveBeenCalledWith("ThreadFile", { path: ["a"] });
  });

  it("lets the tab take a replace, and leaves for one it doesn't", () => {
    const taken = setup(true);
    taken.tab.dispatch({ type: "REPLACE", payload: { name: "ThreadTerminal", params: {} } });
    expect(taken.handlers.replace).toHaveBeenCalledWith("ThreadTerminal", {});
    expect(taken.handlers.leave).not.toHaveBeenCalled();

    const other = setup(false);
    const action = { type: "REPLACE", payload: { name: "Thread", params: {} } };
    other.tab.dispatch(action);
    other.leaves[0]!();
    expect(other.chat.dispatch).toHaveBeenCalledWith(action);
  });

  it("keeps the chat's params and reads through to the chat", () => {
    const { chat, tab } = setup();
    tab.setParams({ inspector: undefined });
    expect(chat.setParams).not.toHaveBeenCalled();
    expect(tab.isFocused()).toBe(true);
  });
});
