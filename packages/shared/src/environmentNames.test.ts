import { expect, it } from "vite-plus/test";
import { readUpcomputerEnvironment } from "./environmentNames.ts";

it("does not read old environment aliases", () => {
  expect(readUpcomputerEnvironment({ T3CODE_PORT: "1234" }, "UPCOMPUTER_PORT")).toBeUndefined();
});

it.each(["5678", ""])("uses the current value verbatim: %s", (value) => {
  expect(
    readUpcomputerEnvironment({ T3CODE_PORT: "1234", UPCOMPUTER_PORT: value }, "UPCOMPUTER_PORT"),
  ).toBe(value);
});
