import { describe, expect, it } from "vite-plus/test";
import {
  isExplicitRelativePath,
  isPathWithinRoot,
  isUncPath,
  isWindowsAbsolutePath,
  isWindowsDrivePath,
  normalizeProjectPathForComparison,
  normalizeProjectPathForDispatch,
} from "./path.ts";

describe("path helpers", () => {
  it("detects windows drive paths", () => {
    expect(isWindowsDrivePath("C:\\repo")).toBe(true);
    expect(isWindowsDrivePath("D:/repo")).toBe(true);
    expect(isWindowsDrivePath("/repo")).toBe(false);
  });

  it("detects UNC paths", () => {
    expect(isUncPath("\\\\server\\share\\repo")).toBe(true);
    expect(isUncPath("C:\\repo")).toBe(false);
  });

  it("detects windows absolute paths", () => {
    expect(isWindowsAbsolutePath("C:\\repo")).toBe(true);
    expect(isWindowsAbsolutePath("\\\\server\\share\\repo")).toBe(true);
    expect(isWindowsAbsolutePath("./repo")).toBe(false);
  });

  it("detects explicit relative paths", () => {
    expect(isExplicitRelativePath(".")).toBe(true);
    expect(isExplicitRelativePath("..")).toBe(true);
    expect(isExplicitRelativePath("./repo")).toBe(true);
    expect(isExplicitRelativePath("..\\repo")).toBe(true);
    expect(isExplicitRelativePath("~/repo")).toBe(false);
  });

  it("normalizes a bare Windows drive root the same as one with a trailing separator", () => {
    // `C:`, `C:\` and `C:/` all refer to the drive root and must compare equal.
    expect(normalizeProjectPathForDispatch("C:")).toBe("C:\\");
    expect(normalizeProjectPathForComparison("C:")).toBe("c:\\");
    expect(normalizeProjectPathForComparison("C:")).toBe(normalizeProjectPathForComparison("C:\\"));
    expect(normalizeProjectPathForComparison("C:")).toBe(normalizeProjectPathForComparison("C:/"));
    // Non-root drive paths keep their trailing separator trimmed as before.
    expect(normalizeProjectPathForDispatch("C:\\repo\\")).toBe("C:\\repo");
  });

  it("checks root containment by whole path segments", () => {
    expect(isPathWithinRoot("/a/foo", "/a/foo")).toBe(true);
    expect(isPathWithinRoot("/a/foo/x.ts", "/a/foo")).toBe(true);
    expect(isPathWithinRoot("/a/foo/x.ts", "/a/foo/")).toBe(true);
    expect(isPathWithinRoot("/a/foobar/x.ts", "/a/foo")).toBe(false);
    expect(isPathWithinRoot("/a", "/a/foo")).toBe(false);
    expect(isPathWithinRoot("/a/x.ts", "/")).toBe(true);
    expect(isPathWithinRoot("C:/Repo/src/x.ts", "c:\\repo")).toBe(true);
    expect(isPathWithinRoot("C:\\Repo2\\x.ts", "C:\\Repo")).toBe(false);
    expect(isPathWithinRoot("D:\\x.ts", "D:\\")).toBe(true);
    expect(isPathWithinRoot("", "/a")).toBe(false);
  });
});
