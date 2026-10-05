// @effect-diagnostics nodeBuiltinImport:off
import * as NodeAssert from "node:assert/strict";
import * as NodePath from "node:path";
import { test } from "vite-plus/test";

import {
  computerUseSidecarExecutableRelativePath,
  resolveManagedComputerUseBinaryPath,
} from "./ManagedComputerUseSidecar.ts";

test("managed sidecar maps every supported desktop target", () => {
  NodeAssert.equal(
    computerUseSidecarExecutableRelativePath({ platform: "darwin", arch: "arm64" }),
    NodePath.join("dist", "Open Computer Use.app", "Contents", "MacOS", "OpenComputerUse"),
  );
  NodeAssert.equal(
    computerUseSidecarExecutableRelativePath({ platform: "linux", arch: "x64" }),
    NodePath.join("dist", "linux", "amd64", "open-computer-use"),
  );
  NodeAssert.equal(
    computerUseSidecarExecutableRelativePath({ platform: "win32", arch: "arm64" }),
    NodePath.join("dist", "windows", "arm64", "open-computer-use.exe"),
  );
});

test("managed sidecar prefers an explicit environment override", () => {
  const binaryPath = resolveManagedComputerUseBinaryPath({
    platform: "linux",
    arch: "x64",
    moduleDirectory: "/app/server",
    packageRoot: "/app/package",
    env: { UPCOMPUTER_COMPUTER_USE_BINARY_PATH: "/opt/upcomputer/ocu" },
    exists: (candidate) => candidate === "/opt/upcomputer/ocu",
  });
  NodeAssert.equal(binaryPath, "/opt/upcomputer/ocu");
});

test("a custom backend path remains available for development", () => {
  NodeAssert.equal(
    resolveManagedComputerUseBinaryPath({ configuredPath: "/tmp/custom-computer-use" }),
    "/tmp/custom-computer-use",
  );
});

test("packaged Electron resolves native binaries from app.asar.unpacked", () => {
  const moduleDirectory = NodePath.join(
    "/Applications",
    "Up.computer.app",
    "Contents",
    "Resources",
    "app.asar",
    "apps",
    "server",
    "dist",
  );
  const expected = NodePath.join(
    "/Applications",
    "Up.computer.app",
    "Contents",
    "Resources",
    "app.asar.unpacked",
    "apps",
    "server",
    "dist",
    "sidecars",
    "open-computer-use",
    "dist",
    "Open Computer Use.app",
    "Contents",
    "MacOS",
    "OpenComputerUse",
  );
  NodeAssert.equal(
    resolveManagedComputerUseBinaryPath({
      platform: "darwin",
      arch: "arm64",
      moduleDirectory,
      packageRoot: "/missing",
      env: {},
      exists: (candidate) => candidate === expected,
    }),
    expected,
  );
});

test("the public desktop build resolves the installed package from app.asar.unpacked", () => {
  const resources = NodePath.join("/Applications", "Up.computer.app", "Contents", "Resources");
  const expected = NodePath.join(
    resources,
    "app.asar.unpacked",
    "node_modules",
    "open-computer-use",
    "dist",
    "linux",
    "amd64",
    "open-computer-use",
  );
  NodeAssert.equal(
    resolveManagedComputerUseBinaryPath({
      platform: "linux",
      arch: "x64",
      moduleDirectory: NodePath.join(resources, "app.asar", "apps", "server", "dist"),
      packageRoot: NodePath.join(resources, "app.asar", "node_modules", "open-computer-use"),
      env: {},
      exists: (candidate) => candidate === expected,
    }),
    expected,
  );
});
