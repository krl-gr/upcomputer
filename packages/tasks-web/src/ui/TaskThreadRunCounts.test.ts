import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import { test } from "vite-plus/test";

const source = NodeFS.readFileSync(new URL("./TaskThreadRunCounts.tsx", import.meta.url), "utf8");
const themeCss = NodeFS.readFileSync(
  new URL("../../../../apps/web/src/index.css", import.meta.url),
  "utf8",
);

/** The `data-slot`s the themed chat header paints as toolbar controls. */
function chatHeaderFilledSlots(): Set<string> {
  const slots = new Set<string>();
  for (const rule of themeCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, selectors = "", body = ""] = rule;
    if (!/\bbackground(?:-color)?\s*:/.test(body)) continue;
    for (const selector of selectors.split(",")) {
      if (!selector.includes("[data-chat-header]")) continue;
      for (const slot of selector.matchAll(/\[data-slot="([^"]+)"\]/g)) slots.add(slot[1]!);
    }
  }
  return slots;
}

test("the chat header run counts are bare numbers in idle, hover and open states", () => {
  const start = source.indexOf("<MenuTrigger");
  const trigger = source.slice(start, source.indexOf("<RunCountNumbers", start));
  const slot = trigger.match(/data-slot="([^"]+)"/)?.[1];
  const className = trigger.match(/className="([^"]+)"/)?.[1] ?? "";

  const filledSlots = chatHeaderFilledSlots();
  NodeAssert.ok(filledSlots.has("menu-trigger"), "the themed header still fills menu triggers");
  NodeAssert.ok(slot, "the trigger names its own slot");
  NodeAssert.ok(!filledSlots.has(slot), `the themed header fills "${slot}"`);

  // No fill from our own classes in any state; feedback is opacity, as in the sidebar row.
  NodeAssert.doesNotMatch(className, /(?:^|[\s:!])bg-/);
  NodeAssert.match(className, /\bhover:opacity-100\b/);
  NodeAssert.match(className, /\bdata-popup-open:opacity-100\b/);
});
