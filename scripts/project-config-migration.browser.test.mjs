import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeModule from "node:module";
import * as NodeTest from "node:test";

const cdp = process.env.UPCOMPUTER_TEST_CDP;
const origin = process.env.UPCOMPUTER_TEST_ORIGIN;
const require = NodeModule.createRequire(new URL("../apps/desktop/package.json", import.meta.url));

NodeTest.test(
  "project config: current precedence and legacy fallback in the integrated Focus menu",
  { skip: !cdp || !origin },
  async () => {
    NodeAssert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    const root = await NodeFSP.mkdtemp(
      NodePath.join(NodeOS.tmpdir(), "upcomputer-project-config-ui-"),
    );
    const currentLabel = `Current ${NodePath.basename(root)}`;
    const legacyLabel = `Legacy ${NodePath.basename(root)}`;
    const current = JSON.stringify({
      scripts: [{ name: currentLabel, command: "echo fixture-only" }],
    });
    await NodeFSP.writeFile(NodePath.join(root, "upcomputer.json"), current);
    await NodeFSP.writeFile(
      NodePath.join(root, "t3.json"),
      JSON.stringify({ scripts: [{ name: legacyLabel, command: "echo fixture-only" }] }),
    );
    const { chromium } = require("playwright-core");
    const browser = await chromium.connectOverCDP(cdp);
    try {
      const page = browser
        .contexts()[0]
        .pages()
        .find((page) => page.url().startsWith(origin + "/"));
      NodeAssert.ok(page);
      await page.goto(origin);
      await page.getByRole("button", { name: "Project", exact: true }).click();
      await page.getByText("Local folder", { exact: true }).click();
      const input = page.getByPlaceholder("Enter path (e.g. ~/projects/my-app)");
      await input.fill(root);
      await input.press("Enter");
      await page
        .getByRole("button", {
          name: `Create new thread in ${NodePath.basename(root)}`,
          exact: true,
        })
        .waitFor();
      await page.waitForTimeout(300);
      const openMenu = async () => {
        await page.reload();
        await page.getByRole("button", { name: "More chat actions", exact: true }).click();
      };
      await openMenu();
      await page.getByText(currentLabel, { exact: true }).waitFor();
      NodeAssert.equal(await page.getByText(legacyLabel, { exact: true }).count(), 0);
      await page.keyboard.press("Escape");
      await NodeFSP.unlink(NodePath.join(root, "upcomputer.json"));
      await openMenu();
      await page.getByText(legacyLabel, { exact: true }).waitFor();
      NodeAssert.equal(await page.getByText(currentLabel, { exact: true }).count(), 0);
      await page.keyboard.press("Escape");
      await NodeFSP.writeFile(NodePath.join(root, "upcomputer.json"), "invalid json fixture");
      await openMenu();
      await page
        .getByText("Invalid upcomputer.json. Fix it before importing actions.", { exact: true })
        .waitFor();
      NodeAssert.equal(await page.getByText(legacyLabel, { exact: true }).count(), 0);
      NodeAssert.equal(await page.getByText(currentLabel, { exact: true }).count(), 0);
      await page.keyboard.press("Escape");
    } finally {
      await NodeFSP.writeFile(NodePath.join(root, "upcomputer.json"), current);
      await browser.close();
    }
  },
);
