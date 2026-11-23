import { act, createElement, useState } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("./MarkdownEditor.tsx", () => {
  throw new Error("chunk load failed");
});

import { LazyMarkdownEditor, preloadMarkdownEditor } from "./LazyMarkdownEditor.tsx";
import { DetailSidebarSection } from "../ui/DetailSidebar.tsx";

describe("LazyMarkdownEditor chunk failure handling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("swallows preloadMarkdownEditor rejections and opens a gated section via the fallback editor on chunk error", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    using consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    let renderer: ReactTestRenderer | null = null;
    const onChange = vi.fn();

    function Harness() {
      const [ready, setReady] = useState(false);
      return createElement(DetailSidebarSection, {
        title: "Description",
        defaultOpen: false,
        contentReady: ready,
        children: createElement(LazyMarkdownEditor, {
          value: "Existing markdown",
          ariaLabel: "Task description",
          onChange,
          onReady: () => setReady(true),
        }),
      });
    }

    try {
      preloadMarkdownEditor();
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(unhandled).not.toHaveBeenCalled();

      await act(async () => {
        renderer = create(createElement(Harness));
      });

      const trigger = () => renderer!.root.findByType("button");
      const panel = () =>
        renderer!.root.find((node) => node.props["data-detail-sidebar-section-panel"] === "");
      expect(trigger().props["aria-expanded"]).toBe(false);

      await act(async () => {
        trigger().props.onClick();
        await Promise.resolve();
        await Promise.resolve();
      });

      // Fallback textarea renders, signals onReady immediately, and opens the accordion without waiting for the timeout.
      const fallback = renderer!.root.findByType("textarea");
      expect(fallback.props["aria-label"]).toBe("Task description");
      expect(fallback.props.value).toBe("Existing markdown");
      expect(trigger().props["aria-expanded"]).toBe(true);
      expect(panel().props["data-open"]).toBe(true);
      expect(unhandled).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
      await act(async () => renderer?.unmount());
    }
  });
});
