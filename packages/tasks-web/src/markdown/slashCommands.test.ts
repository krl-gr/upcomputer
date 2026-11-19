import { decodeMsg } from "gt-react";
import { describe, expect, it } from "vite-plus/test";

import { slashCommandsFor } from "./slashCommands.ts";

const RUSSIAN: Readonly<Record<string, string>> = {
  "Heading 1": "Заголовок 1",
  "Heading 2": "Заголовок 2",
  "Heading 3": "Заголовок 3",
  "Bullet list": "Маркированный список",
};
const russian = (label: string) => RUSSIAN[decodeMsg(label)] ?? decodeMsg(label);
const ids = (query: string) => slashCommandsFor(query, russian).map((command) => command.id);

describe("slash menu", () => {
  it("finds a block by its translated name, its English name, its id or a keyword", () => {
    expect(ids("заг")).toEqual(["h1", "h2", "h3"]);
    expect(ids("head")).toEqual(["h1", "h2", "h3"]);
    expect(ids("H2")).toEqual(["h2"]);
    expect(ids("todo")).toEqual(["task"]);
    expect(slashCommandsFor("bullet", russian).map((command) => command.label)).toEqual([
      "Маркированный список",
    ]);
  });
});
