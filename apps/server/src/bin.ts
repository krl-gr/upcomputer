import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { Command } from "effect/unstable/cli";
import * as CliError from "effect/unstable/cli/CliError";

import * as NetService from "@upcomputer/shared/Net";
import { UPCOMPUTER_RELEASE_CAPABILITIES } from "@upcomputer/shared/upcomputerReleasePolicy";
import packageJson from "../package.json" with { type: "json" };
import { authCommand } from "./cli/auth.ts";
import { connectCommand } from "./cli/connect.ts";
import { hasCloudPublicConfig } from "./cloud/publicConfig.ts";
import { type CliServerFlags, sharedServerCommandFlags } from "./cli/config.ts";
import { projectCommand } from "./cli/project.ts";
import { makeServeCommand, makeStartCommand, runServerCommand } from "./cli/server.ts";
import { serviceCommand } from "./cli/service.ts";
import { CORE_SERVER_PRODUCT_ENTRY } from "./product/defaultProductEntry.ts";

const CliRuntimeLayer = Layer.mergeAll(NodeServices.layer, NetService.layer);

const connectPublicConfigMissingMessage =
  "T3 Connect commands are unavailable: this build is missing T3 Connect public configuration.";

class ConnectPublicConfigMissingError extends CliError.UserError {
  override get message() {
    return connectPublicConfigMissingMessage;
  }
}

class RemoteServerCliUnavailableError extends CliError.UserError {
  override get message() {
    return "The official Up.computer CLI/headless server is unavailable in this release. Use the Desktop application.";
  }
}

const bundledDesktopCommandFlags = {
  bootstrapFd: sharedServerCommandFlags.bootstrapFd,
} as const;

function bundledDesktopServerFlags(bootstrapFd: Option.Option<number>): CliServerFlags {
  return {
    mode: Option.none(),
    port: Option.none(),
    host: Option.none(),
    baseDir: Option.none(),
    cwd: Option.none(),
    devUrl: Option.none(),
    noBrowser: Option.none(),
    bootstrapFd,
    autoBootstrapProjectFromCwd: Option.none(),
    logWebSocketEvents: Option.none(),
    tailscaleServeEnabled: Option.none(),
    tailscaleServePort: Option.none(),
  };
}

const connectUnavailableCommand = Command.make("connect").pipe(
  Command.withDescription("T3 Connect is unavailable in builds without public configuration."),
  Command.withHidden,
  Command.withHandler(() =>
    Effect.fail(
      new CliError.ShowHelp({
        commandPath: ["t3", "connect"],
        errors: [new ConnectPublicConfigMissingError({ cause: connectPublicConfigMissingMessage })],
      }),
    ),
  ),
);

export const makeCli = ({
  cloudEnabled = hasCloudPublicConfig,
  remoteServerCliEnabled = UPCOMPUTER_RELEASE_CAPABILITIES.npmRemoteServerDistribution ||
    Boolean(process.env.VITE_DEV_SERVER_URL?.trim()),
}: {
  readonly cloudEnabled?: boolean;
  /** Test/source-development escape hatch; official builds keep this false. */
  readonly remoteServerCliEnabled?: boolean;
} = {}) =>
  Command.make(
    "t3",
    remoteServerCliEnabled ? { ...sharedServerCommandFlags } : bundledDesktopCommandFlags,
  ).pipe(
    Command.withDescription(
      remoteServerCliEnabled
        ? `Run the ${CORE_SERVER_PRODUCT_ENTRY.manifest.displayName} server.`
        : "Internal backend entry point for Up.computer Desktop.",
    ),
    // The Desktop backend is the only official caller and supplies a bootstrap envelope.
    Command.withHandler((flags) => {
      if (!remoteServerCliEnabled) {
        return Option.isSome(flags.bootstrapFd)
          ? runServerCommand(bundledDesktopServerFlags(flags.bootstrapFd))
          : Effect.fail(new RemoteServerCliUnavailableError({ cause: "local-desktop-only" }));
      }
      return runServerCommand(flags as CliServerFlags);
    }),
    Command.withSubcommands(
      remoteServerCliEnabled
        ? [
            makeStartCommand(CORE_SERVER_PRODUCT_ENTRY),
            makeServeCommand(CORE_SERVER_PRODUCT_ENTRY),
            authCommand,
            projectCommand,
            serviceCommand,
            cloudEnabled ? connectCommand : connectUnavailableCommand,
          ]
        : [],
    ),
  );

export const cli = makeCli();

if (import.meta.main) {
  Command.run(cli, { version: packageJson.version }).pipe(
    Effect.scoped,
    Effect.provide(CliRuntimeLayer),
    NodeRuntime.runMain,
  );
}
