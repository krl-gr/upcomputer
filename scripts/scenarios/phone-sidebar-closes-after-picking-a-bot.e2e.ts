import { expect } from "e2e";

import { test, WEB } from "./t3.ts";

test(
  "On a phone, picking an entry in the Bots section closes the sidebar over the page",
  WEB,
  async ({ t3, app, screen, browser }) => {
    await browser.setViewport({ width: 390, height: 844 });
    const project = await t3.project("demo");
    const thread = await t3.thread({ project, title: "Earlier work", messages: ["first"] });
    await t3.open(thread);
    await expect(screen.getByText("first fixture turn complete", { exact: false })).toBeVisible();

    await screen.getByRole("button", "Toggle main sidebar").tap();
    const newBot = screen.getByRole("button", "New bot").last();
    await expect(newBot).toBeVisible();
    await newBot.tap();
    await expect(browser).toHaveURL(/\/bots\b/);
    await app.screenshot("after-picking-new-bot");

    const sheetOpen = () =>
      browser.evaluate(
        () =>
          document
            .querySelector('[data-slot="sidebar"][data-mobile="true"]')
            ?.hasAttribute("data-open") ?? false,
      );
    await expect.poll(sheetOpen).toBe(false);
  },
);
