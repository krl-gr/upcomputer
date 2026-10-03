// Opt-in rendered regression pass against an already paired, disposable dev profile.
// UPCOMPUTER_TEST_CDP=http://127.0.0.1:19459 UPCOMPUTER_TEST_ORIGIN=http://127.0.0.1:5919 \
//   node --test scripts/workspace-chrome.browser.test.mjs
// This creates draft tabs, but never sends prompts. Windows classes exercise CSS,
// not native caption buttons: an installed Windows smoke pass is still required.
import * as NodeAssert from "node:assert/strict";
import * as NodeModule from "node:module";
import * as NodeTest from "node:test";

const require = NodeModule.createRequire(new URL("../apps/desktop/package.json", import.meta.url));
const cdp = process.env.UPCOMPUTER_TEST_CDP;
const origin = process.env.UPCOMPUTER_TEST_ORIGIN;

NodeTest.test(
  "workspace chrome: rendered geometry and responsive sidebar",
  { skip: !cdp || !origin },
  async () => {
    NodeAssert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    const { chromium } = require("playwright-core");
    const browser = await chromium.connectOverCDP(cdp);
    const page = browser
      .contexts()[0]
      .pages()
      .find((page) => page.url().startsWith(origin + "/"));
    NodeAssert.ok(page, "Pair a disposable dev profile first");
    const originalClasses = await page.locator("html").getAttribute("class");
    const session = await page.context().newCDPSession(page);
    try {
      await page.setViewportSize({ width: 1200, height: 850 });
      while ((await page.locator(".dv-tab").count()) < 3) {
        await page.getByRole("button", { name: "New workspace tab", exact: true }).click();
      }
      for (const windows of [false, true]) {
        await page.evaluate((windows) => {
          for (const name of ["electron", "electron-windows", "wco", "wco-windows"]) {
            document.documentElement.classList.toggle(name, windows);
          }
        }, windows);
        for (const scale of [1, 1.25, 1.5]) {
          await session.send("Emulation.setDeviceMetricsOverride", {
            width: 1200,
            height: 850,
            deviceScaleFactor: scale,
            mobile: false,
          });
          const tabs = page.locator(".dv-tab");
          for (let i = 0; i < (await tabs.count()); i++) {
            await tabs.nth(i).focus();
            const geometry = await tabs.nth(i).evaluate((tab) => {
              const rect = tab.getBoundingClientRect();
              const content = tab
                .querySelector(".upcomputer-workspace-tab")
                .getBoundingClientRect();
              const focus = getComputedStyle(tab, "::after");
              return {
                height: rect.height,
                contentHeight: content.height,
                inset: content.top - rect.top,
                bottomInset: rect.bottom - content.bottom,
                focusTop: parseFloat(focus.top),
                focusHeight: parseFloat(focus.height),
              };
            });
            NodeAssert.deepEqual(geometry, {
              height: windows ? 40 : 48,
              contentHeight: 32,
              inset: windows ? 4 : 8,
              bottomInset: windows ? 4 : 8,
              focusTop: windows ? 4 : 8,
              focusHeight: 32,
            });
          }
        }
      }
      for (const width of [1200, 768, 767, 640, 639, 400]) {
        await session.send("Emulation.setDeviceMetricsOverride", {
          width,
          height: 850,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await page.waitForTimeout(350);
        NodeAssert.equal(
          await page.locator('[data-slot="sidebar-container"]').count(),
          width >= 640 ? 1 : 0,
        );
        if (width < 640) {
          await page.getByRole("button", { name: "Toggle Sidebar", exact: true }).click();
          const surface = page.locator('[data-mobile="true"][data-slot="sidebar"]');
          await surface.waitFor({ state: "visible" });
          NodeAssert.match(
            await surface.getAttribute("data-upcomputer-sidebar-version"),
            /^v[12]$/,
          );
          NodeAssert.ok(await surface.getAttribute("data-sidebar-mode"));
          const mode = await surface.getAttribute("data-sidebar-mode");
          await surface.getByRole("button", { name: /^(Focus|Classic) view$/ }).click();
          await page.waitForTimeout(150);
          NodeAssert.notEqual(await surface.getAttribute("data-sidebar-mode"), mode);
          NodeAssert.equal(await surface.getAttribute("data-upcomputer-sidebar-version"), "v1");
          await surface.getByRole("button", { name: /^(Focus|Classic) view$/ }).click();
          await page.keyboard.press("Escape");
          await surface.waitFor({ state: "hidden" });
        }
        NodeAssert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
        );
      }
      const overflow = page.getByRole("button", { name: "More workspace tabs", exact: true });
      await overflow.click();
      await page.getByRole("menuitem").first().click();
      NodeAssert.equal(await page.locator(".dv-tab.dv-active-tab").count(), 1);
      await page.setViewportSize({ width: 1200, height: 850 });
      await session.send("Emulation.setDeviceMetricsOverride", {
        width: 1200,
        height: 850,
        deviceScaleFactor: 1,
        mobile: false,
      });
      const before = await page.locator(".dv-tab").count();
      await page.locator(".dv-tab").first().click();
      await page.getByRole("button", { name: /^Close New thread$/ }).click();
      NodeAssert.equal(await page.locator(".dv-tab").count(), before - 1);
    } finally {
      await page.evaluate(
        (value) => document.documentElement.setAttribute("class", value ?? ""),
        originalClasses,
      );
      // Never leave a human test window pinned to automated viewport metrics.
      await session.send("Emulation.setDeviceMetricsOverride", {
        width: 0,
        height: 0,
        deviceScaleFactor: 0,
        mobile: false,
      });
      await session.detach();
      await browser.close();
    }
  },
);
