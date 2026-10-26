import * as Schema from "effect/Schema";
import { assert, test } from "vite-plus/test";

import { BotAppearance, botPortraitIds, defaultBotPortrait } from "./bots.ts";

const decodeAppearance = Schema.decodeUnknownSync(BotAppearance);

test("a bot without a picked portrait keeps the one its id derives", () => {
  // Pinned so a reordered catalog cannot change the faces of existing bots.
  assert.equal(defaultBotPortrait("bot:alpha"), "rembrandt");
  assert.equal(defaultBotPortrait("bot:3f2a9c1e-7d4b-4e8a-9c2f-1a2b3c4d5e6f"), "son-of-man");
  const derived = new Set(
    Array.from({ length: 400 }, (_, index) => defaultBotPortrait(`bot:${index}`)),
  );
  assert.equal(derived.size, botPortraitIds.length);
});

test("appearance decodes with or without a portrait, but not an unknown one", () => {
  const character = { shape: "capsule", color: "blue", accessory: "none" } as const;
  assert.deepStrictEqual(decodeAppearance(character), character);
  assert.deepStrictEqual(decodeAppearance({ ...character, portrait: "frida" }), {
    ...character,
    portrait: "frida",
  });
  assert.throws(() => decodeAppearance({ ...character, portrait: "unknown" }));
});

test("appearance decodes with or without a style, but not an unknown one", () => {
  const character = { shape: "capsule", color: "blue", accessory: "none" } as const;
  assert.deepStrictEqual(decodeAppearance({ ...character, style: "character" }), {
    ...character,
    style: "character",
  });
  assert.throws(() => decodeAppearance({ ...character, style: "unknown" }));
});
