import { expect, it } from "vite-plus/test";
import { ProjectReadFileError } from "@upcomputer/contracts";
import { isMissingProjectConfigFile } from "./projectConfigReadError.ts";

it("recognizes an explicit missing-file result", () => {
  const base = {
    cwd: "/fixture",
    relativePath: "upcomputer.json",
    failure: "operation_failed" as const,
  };
  expect(isMissingProjectConfigFile(new ProjectReadFileError({ ...base, notFound: true }))).toBe(
    true,
  );
  expect(isMissingProjectConfigFile(new ProjectReadFileError({ ...base, notFound: false }))).toBe(
    false,
  );
  expect(isMissingProjectConfigFile(new ProjectReadFileError(base))).toBe(false);
  expect(isMissingProjectConfigFile(new Error("ENOENT"))).toBe(false);
});
