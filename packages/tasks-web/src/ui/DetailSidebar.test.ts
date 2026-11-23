import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import { act, createElement, type ReactElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { expect, test, vi } from "vite-plus/test";

import {
  DETAIL_SECTION_READY_FALLBACK_MS,
  DetailColumn,
  DetailSidebarSection,
} from "./DetailSidebar.tsx";

// Any background utility, in any state: `bg-x`, `hover:bg-x`, `dark:!bg-x`.
const BACKGROUND_CLASS = /(?:^|[\s:!])bg-/;

test("the detail column has no background of its own and uses the regular tokens", () => {
  const column = DetailColumn({ children: null }) as ReactElement<{ className: string }>;
  const className = column.props.className;

  NodeAssert.equal(column.type, "aside");
  NodeAssert.doesNotMatch(className, BACKGROUND_CLASS);
  NodeAssert.doesNotMatch(className, /sidebar/);
  NodeAssert.match(className, /\bborder-l border-border\b/);
  NodeAssert.match(className, /\btext-foreground\b/);
});

test("task and agent views render both detail columns through DetailColumn", () => {
  for (const view of ["TasksView.tsx", "AgentsView.tsx"]) {
    const source = NodeFS.readFileSync(new URL(`./${view}`, import.meta.url), "utf8");
    // The existing item and the create form.
    NodeAssert.equal(source.match(/<DetailColumn[\s>]/g)?.length, 2, view);
    NodeAssert.doesNotMatch(source, /<aside/, view);
    NodeAssert.doesNotMatch(source, /\b(?:bg|text)-sidebar/, view);
  }
});

test("DetailSidebarSection falls back to opening after 300ms if contentReady never arrives, and cancels if closed early", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  let renderer: ReactTestRenderer | null = null;
  const onWarm = vi.fn();

  try {
    await act(async () => {
      renderer = create(
        createElement(DetailSidebarSection, {
          title: "Description",
          defaultOpen: false,
          contentReady: false,
          onWarm,
          children: createElement("span", { "data-body": "true" }, "Body"),
        }),
      );
    });

    const trigger = () => renderer!.root.findByType("button");
    const panel = () =>
      renderer!.root.find((node) => node.props["data-detail-sidebar-section-panel"] === "");
    const bodies = () => renderer!.root.findAll((node) => node.props["data-body"] === "true");

    expect(panel().props.id).toBeTruthy();
    expect(trigger().props["aria-controls"]).toBe(panel().props.id);
    expect(trigger().props["aria-expanded"]).toBe(false);
    expect(panel().props["data-open"]).toBe(false);
    expect(panel().props.inert).toBe(true);
    expect(bodies()).toHaveLength(0);

    // Pointer enter and focus only call onWarm, without mounting the body.
    await act(async () => {
      trigger().props.onPointerEnter?.();
      trigger().props.onFocus?.();
    });
    expect(onWarm).toHaveBeenCalledTimes(2);
    expect(bodies()).toHaveLength(0);

    // Open while contentReady stays false: mounts body, stays gated with matching ARIA until the 300ms fallback.
    await act(async () => {
      trigger().props.onClick();
    });
    expect(bodies()).toHaveLength(1);
    expect(trigger().props["aria-expanded"]).toBe(false);
    expect(panel().props["data-open"]).toBe(false);
    expect(panel().props.inert).toBe(true);

    // Closing before the 300ms fallback cancels the timer so it stays closed.
    await act(async () => {
      vi.advanceTimersByTime(DETAIL_SECTION_READY_FALLBACK_MS - 50);
      trigger().props.onClick();
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(trigger().props["aria-expanded"]).toBe(false);
    expect(panel().props["data-open"]).toBe(false);

    // Reopening and letting the 300ms fallback elapse opens the section even without contentReady.
    await act(async () => {
      trigger().props.onClick();
    });
    expect(trigger().props["aria-expanded"]).toBe(false);
    await act(async () => {
      vi.advanceTimersByTime(DETAIL_SECTION_READY_FALLBACK_MS);
    });
    expect(trigger().props["aria-expanded"]).toBe(true);
    expect(panel().props["data-open"]).toBe(true);
    expect(panel().props.inert).toBe(false);
  } finally {
    await act(async () => renderer?.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
