import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";

import { COMPUTER_USE_DEFAULT_BINARY_PATH } from "@upcomputer/computer-use-contracts/settings";

const COMPUTER_USE_SIDECAR_PACKAGE = "open-computer-use" as const;
export const COMPUTER_USE_SIDECAR_VERSION = "0.3.5" as const;
const COMPUTER_USE_SIDECAR_ENV = "UPCOMPUTER_COMPUTER_USE_BINARY_PATH" as const;

export interface ComputerUseSidecarPlatform {
  readonly platform: NodeJS.Platform;
  readonly arch: NodeJS.Architecture;
}

export function computerUseSidecarExecutableRelativePath({
  platform,
  arch,
}: ComputerUseSidecarPlatform): string {
  if (platform === "darwin" && (arch === "arm64" || arch === "x64")) {
    return NodePath.join("dist", "Open Computer Use.app", "Contents", "MacOS", "OpenComputerUse");
  }
  const packageArch = arch === "x64" ? "amd64" : arch;
  if (platform === "linux" && (packageArch === "amd64" || packageArch === "arm64")) {
    return NodePath.join("dist", "linux", packageArch, "open-computer-use");
  }
  if (platform === "win32" && (packageArch === "amd64" || packageArch === "arm64")) {
    return NodePath.join("dist", "windows", packageArch, "open-computer-use.exe");
  }
  throw new Error(`Managed Computer Use is unavailable on ${platform}-${arch}.`);
}

function installedPackageRoot(): string | undefined {
  try {
    const require = NodeModule.createRequire(import.meta.url);
    return NodePath.dirname(require.resolve(`${COMPUTER_USE_SIDECAR_PACKAGE}/package.json`));
  } catch {
    return undefined;
  }
}

function managedComputerUseSidecarCandidates(input?: {
  readonly platform?: NodeJS.Platform;
  readonly arch?: NodeJS.Architecture;
  readonly moduleDirectory?: string;
  readonly packageRoot?: string;
  readonly env?: NodeJS.ProcessEnv;
}): ReadonlyArray<string> {
  // oxlint-disable-next-line upcomputer/no-global-process-runtime -- Plain helper; callers and tests pass `platform` and `arch`.
  const platform = input?.platform ?? process.platform;
  // oxlint-disable-next-line upcomputer/no-global-process-runtime -- Plain helper; callers and tests pass `platform` and `arch`.
  const arch = input?.arch ?? process.arch;
  const relativeExecutable = computerUseSidecarExecutableRelativePath({ platform, arch });
  const environmentPath = (input?.env ?? process.env)[COMPUTER_USE_SIDECAR_ENV]?.trim();
  const moduleDirectory = input?.moduleDirectory ?? import.meta.dirname;
  const asarSegment = `${NodePath.sep}app.asar${NodePath.sep}`;
  const unpacked = (directory: string) =>
    directory.includes(asarSegment)
      ? directory.replace(asarSegment, `${NodePath.sep}app.asar.unpacked${NodePath.sep}`)
      : undefined;
  const unpackedModuleDirectory = unpacked(moduleDirectory);
  const packageRoot = input?.packageRoot ?? installedPackageRoot();
  // The public desktop build installs the package into node_modules and unpacks it.
  const unpackedPackageRoot = packageRoot ? unpacked(packageRoot) : undefined;
  return [
    environmentPath,
    unpackedModuleDirectory
      ? NodePath.join(
          unpackedModuleDirectory,
          "sidecars",
          COMPUTER_USE_SIDECAR_PACKAGE,
          relativeExecutable,
        )
      : undefined,
    NodePath.join(moduleDirectory, "sidecars", COMPUTER_USE_SIDECAR_PACKAGE, relativeExecutable),
    NodePath.resolve(
      moduleDirectory,
      "..",
      "sidecars",
      COMPUTER_USE_SIDECAR_PACKAGE,
      relativeExecutable,
    ),
    unpackedPackageRoot ? NodePath.join(unpackedPackageRoot, relativeExecutable) : undefined,
    packageRoot ? NodePath.join(packageRoot, relativeExecutable) : undefined,
  ].filter((candidate): candidate is string => Boolean(candidate));
}

export function resolveManagedComputerUseBinaryPath(input?: {
  readonly configuredPath?: string;
  readonly platform?: NodeJS.Platform;
  readonly arch?: NodeJS.Architecture;
  readonly moduleDirectory?: string;
  readonly packageRoot?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly exists?: (candidate: string) => boolean;
}): string {
  const configuredPath = input?.configuredPath?.trim();
  if (configuredPath && configuredPath !== COMPUTER_USE_DEFAULT_BINARY_PATH) {
    return configuredPath;
  }
  const exists = input?.exists ?? NodeFS.existsSync;
  const candidates = managedComputerUseSidecarCandidates(input);
  const executable = candidates.find(exists);
  if (executable) return executable;
  throw new Error(
    // oxlint-disable-next-line upcomputer/no-global-process-runtime -- Plain helper; callers and tests pass `platform` and `arch`.
    `The managed Computer Use sidecar is missing for ${input?.platform ?? process.platform}-${input?.arch ?? process.arch}. ` +
      `Checked: ${candidates.join(", ")}`,
  );
}
