import { assert, test } from "vite-plus/test";
import { botPortraitIds } from "@t3tools/tasks-contracts/v1";
import { botPortraits, loadBotPortrait } from "./botPortraits.ts";

test("every portrait in the catalog has a label and artwork that can blink", async () => {
  assert.deepStrictEqual(
    botPortraits.map((portrait) => portrait.id),
    [...botPortraitIds],
  );
  for (const { id, label } of botPortraits) {
    assert.ok(label.length > 0, id);
    const svg = (await loadBotPortrait(id)) ?? "";
    assert.ok(svg.trimStart().startsWith("<svg"), id);
    assert.equal(svg.match(/class="bot-eye"/g)?.length, 2, id);
    assert.ok(svg.includes('class="bot-body"'), id);
    assert.ok(!svg.includes("<title>"), id);
  }
});
