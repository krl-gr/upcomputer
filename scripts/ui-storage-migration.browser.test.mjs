// Use the paired disposable profile described in workspace-chrome.browser.test.mjs.
// This test creates an unsent draft and simulates legacy UI keys; it never sends it.
import * as NodeAssert from "node:assert/strict";
import * as NodeModule from "node:module";
import * as NodeTest from "node:test";
const require = NodeModule.createRequire(new URL("../apps/desktop/package.json", import.meta.url));
const cdp = process.env.UPCOMPUTER_TEST_CDP;
const origin = process.env.UPCOMPUTER_TEST_ORIGIN;
NodeTest.test(
  "legacy UI state survives migration and reload",
  { skip: !cdp || !origin },
  async () => {
    NodeAssert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    const { chromium } = require("playwright-core");
    const browser = await chromium.connectOverCDP(cdp);
    try {
      const page = browser
        .contexts()[0]
        .pages()
        .find((page) => page.url().startsWith(origin + "/"));
      NodeAssert.ok(page);
      const editor = page.locator("[contenteditable=true]").first();
      await editor.fill("Unsent rename migration fixture");
      await page.waitForTimeout(1200);
      NodeAssert.ok(
        await page.evaluate(() =>
          localStorage
            .getItem("upcomputer:composer-drafts:v1")
            ?.includes("Unsent rename migration fixture"),
        ),
      );
      await page.evaluate(() => {
        for (const name of ["composer-drafts:v1", "chat-workspace:v1", "client-settings:v1"]) {
          const key = "upcomputer:" + name,
            old = "t3code:" + name,
            value = localStorage.getItem(key);
          if (value !== null) {
            localStorage.setItem(old, value);
            localStorage.removeItem(key);
          }
        }
        localStorage.removeItem("upcomputer:theme");
        localStorage.setItem("t3code:theme", "dark");
      });
      await page.reload();
      await editor.waitFor();
      await page.waitForTimeout(1800);
      NodeAssert.equal(await editor.innerText(), "Unsent rename migration fixture");
      NodeAssert.ok(await page.locator("html").evaluate((x) => x.classList.contains("dark")));
      NodeAssert.equal(await page.evaluate(() => localStorage.getItem("upcomputer:theme")), "dark");
      NodeAssert.equal(
        await page.evaluate(() => localStorage.getItem("t3code:composer-drafts:v1")),
        null,
      );
    } finally {
      await browser.close();
    }
  },
);
