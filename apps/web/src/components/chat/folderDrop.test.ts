import { EnvironmentId } from "@upcomputer/contracts";
import { describe, expect, it } from "vite-plus/test";

import { folderDropTarget, resolveDroppedFolderPath, splitDroppedItems } from "./folderDrop";

const environmentId = EnvironmentId.make("environment-1");

describe("folderDropTarget", () => {
  it("targets local when the thread is on the primary environment", () => {
    expect(folderDropTarget({ environmentId, primaryEnvironmentId: environmentId })).toBe("local");
  });

  it("targets remote when the thread lives on another environment", () => {
    expect(
      folderDropTarget({
        environmentId: EnvironmentId.make("environment-2"),
        primaryEnvironmentId: environmentId,
      }),
    ).toBe("remote");
  });

  it("targets remote when no primary environment is known", () => {
    expect(folderDropTarget({ environmentId, primaryEnvironmentId: null })).toBe("remote");
  });
});

describe("resolveDroppedFolderPath", () => {
  it("returns the native path when the bridge provides it", () => {
    const folder = new File([], "contracts");
    expect(resolveDroppedFolderPath(folder, () => "/tmp/project/contracts")).toBe(
      "/tmp/project/contracts",
    );
  });

  it("returns null without a desktop bridge (browser or phone)", () => {
    expect(resolveDroppedFolderPath(new File([], "contracts"), undefined)).toBeNull();
  });

  it("returns null when the bridge returns an empty path", () => {
    expect(resolveDroppedFolderPath(new File([], "contracts"), () => "")).toBeNull();
  });
});

describe("splitDroppedItems", () => {
  const file = new File(["contents"], "example.png", { type: "image/png" });
  const folder = new File([], "project", { type: "" });
  const entry = (value: File, isDirectory: boolean) => ({
    kind: "file",
    getAsFile: () => value,
    webkitGetAsEntry: () => ({ isDirectory }),
  });

  it("routes mixed drops to files and folders", () => {
    expect(
      splitDroppedItems({
        files: [file, folder],
        items: [entry(folder, true), entry(file, false)],
      }),
    ).toEqual({ files: [file], folders: [folder] });
  });

  it("treats every file as a file when items are unavailable", () => {
    expect(splitDroppedItems({ files: [file] })).toEqual({ files: [file], folders: [] });
  });
});
