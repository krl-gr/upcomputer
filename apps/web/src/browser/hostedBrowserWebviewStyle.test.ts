import { describe, expect, it } from "vite-plus/test";

import type { BrowserSurfaceRect } from "./browserSurfaceStore";
import {
  HIDDEN_BROWSER_WEBVIEW_OFFSET,
  resolveHostedBrowserWebviewWrapperStyle,
} from "./hostedBrowserWebviewStyle";

describe("resolveHostedBrowserWebviewWrapperStyle", () => {
  it("places an active webview on its presented surface", () => {
    expect(
      resolveHostedBrowserWebviewWrapperStyle({
        active: true,
        renderingActive: true,
        rect: { x: 12, y: 34, width: 800, height: 600 },
        hiddenSize: { width: 1280, height: 800 },
      }),
    ).toEqual({
      left: 12,
      top: 34,
      width: 800,
      height: 600,
      zIndex: 30,
      pointerEvents: "auto",
    });
  });

  it("clips a floating webview to the mini-player frame", () => {
    expect(
      resolveHostedBrowserWebviewWrapperStyle({
        active: true,
        renderingActive: true,
        cornerRadius: 12,
        zIndex: 48,
        rect: { x: 12, y: 34, width: 360, height: 203 },
        hiddenSize: { width: 1280, height: 800 },
      }),
    ).toMatchObject({
      left: 12,
      top: 34,
      width: 360,
      height: 203,
      borderRadius: 12,
      zIndex: 48,
    });
  });

  it("suspends painting for an inactive webview", () => {
    const style = resolveHostedBrowserWebviewWrapperStyle({
      active: false,
      renderingActive: false,
      rect: { x: 12, y: 34, width: 800, height: 600 },
      hiddenSize: { width: 393, height: 852 },
    });

    expect(style).toEqual({
      left: HIDDEN_BROWSER_WEBVIEW_OFFSET,
      top: HIDDEN_BROWSER_WEBVIEW_OFFSET,
      width: 393,
      height: 852,
      zIndex: -1,
      pointerEvents: "none",
      visibility: "hidden",
    });
  });

  it("keeps an active background task paintable behind the app", () => {
    const style = resolveHostedBrowserWebviewWrapperStyle({
      active: false,
      renderingActive: true,
      rect: null,
      hiddenSize: { width: 1280, height: 800 },
    });

    expect(style).toEqual({
      left: 0,
      top: 0,
      width: 1280,
      height: 800,
      zIndex: -1,
      pointerEvents: "none",
      visibility: "visible",
    });
  });

  it("keeps an inactive webview paintable without marking it as rendering-active", () => {
    const style = resolveHostedBrowserWebviewWrapperStyle({
      active: false,
      renderingActive: false,
      keepPaintableWhenInactive: true,
      rect: null,
      hiddenSize: { width: 1280, height: 800 },
    });

    expect(style).toEqual({
      left: HIDDEN_BROWSER_WEBVIEW_OFFSET,
      top: HIDDEN_BROWSER_WEBVIEW_OFFSET,
      width: 1280,
      height: 800,
      zIndex: -1,
      pointerEvents: "none",
      visibility: "visible",
    });
  });

  it("keeps upstream's window origin without a backdrop", () => {
    expect(
      resolveHostedBrowserWebviewWrapperStyle({
        active: false,
        renderingActive: true,
        rect: null,
        hiddenSize: { width: 1280, height: 800 },
        hiddenBackdrop: null,
      }),
    ).toMatchObject({ left: 0, top: 0, width: 1280, height: 800, zIndex: -1 });
  });

  describe("behind the opaque inset of a translucent sidebar", () => {
    const contains = (outer: BrowserSurfaceRect, inner: BrowserSurfaceRect) =>
      inner.x >= outer.x &&
      inner.y >= outer.y &&
      inner.x + inner.width <= outer.x + outer.width &&
      inner.y + inner.height <= outer.y + outer.height;
    const intersects = (a: BrowserSurfaceRect, b: BrowserSurfaceRect) =>
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

    const windows = [
      { width: 1440, height: 900, sidebar: 260 },
      { width: 2560, height: 1440, sidebar: 420 },
      { width: 900, height: 600, sidebar: 300 },
      { width: 700, height: 500, sidebar: 0 },
    ];
    const hiddenSizes = [
      { width: 1280, height: 800 },
      { width: 393, height: 852 },
      { width: 1920, height: 1080 },
      { width: 320, height: 240 },
    ];

    it("never overlaps the sidebar and stays inside the window and the inset", () => {
      for (const { width, height, sidebar } of windows) {
        const viewport = { x: 0, y: 0, width, height };
        const sidebarRect = { x: 0, y: 0, width: sidebar, height };
        const inset = { x: sidebar, y: 0, width: width - sidebar, height };
        for (const hiddenSize of hiddenSizes) {
          const style = resolveHostedBrowserWebviewWrapperStyle({
            active: false,
            renderingActive: true,
            rect: null,
            hiddenSize,
            hiddenBackdrop: inset,
          });
          const placed = { x: style.left, y: style.top, width: style.width, height: style.height };
          expect(intersects(placed, sidebarRect)).toBe(false);
          expect(contains(viewport, placed)).toBe(true);
          expect(contains(inset, placed)).toBe(true);
          expect(placed.width).toBeGreaterThan(0);
          expect(placed.height).toBeGreaterThan(0);
          expect(style).toMatchObject({ zIndex: -1, pointerEvents: "none", visibility: "visible" });
        }
      }
    });

    it("clips the wrapper to a narrow inset and keeps the full size where it fits", () => {
      const inset = { x: 300, y: 0, width: 600, height: 600 };
      expect(
        resolveHostedBrowserWebviewWrapperStyle({
          active: false,
          renderingActive: true,
          rect: null,
          hiddenSize: { width: 1280, height: 800 },
          hiddenBackdrop: inset,
        }),
      ).toMatchObject({ left: 300, top: 0, width: 600, height: 600 });
      expect(
        resolveHostedBrowserWebviewWrapperStyle({
          active: false,
          renderingActive: true,
          rect: null,
          hiddenSize: { width: 393, height: 500 },
          hiddenBackdrop: inset,
        }),
      ).toMatchObject({ left: 300, top: 0, width: 393, height: 500 });
    });

    it("leaves shown and suspended webviews where upstream puts them", () => {
      const inset = { x: 260, y: 0, width: 1180, height: 900 };
      const rect = { x: 700, y: 40, width: 700, height: 820 };
      expect(
        resolveHostedBrowserWebviewWrapperStyle({
          active: true,
          renderingActive: true,
          rect,
          hiddenSize: { width: 1280, height: 800 },
          hiddenBackdrop: inset,
        }),
      ).toMatchObject({ left: 700, top: 40, width: 700, height: 820, zIndex: 30 });
      expect(
        resolveHostedBrowserWebviewWrapperStyle({
          active: false,
          renderingActive: false,
          keepPaintableWhenInactive: true,
          rect,
          hiddenSize: { width: 1280, height: 800 },
          hiddenBackdrop: inset,
        }),
      ).toMatchObject({
        left: HIDDEN_BROWSER_WEBVIEW_OFFSET,
        top: HIDDEN_BROWSER_WEBVIEW_OFFSET,
      });
    });
  });
});
