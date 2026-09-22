import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NetService from "@upcomputer/shared/Net";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Command } from "effect/unstable/cli";
import * as CliError from "effect/unstable/cli/CliError";

import { authCommand } from "../cli/auth.ts";
import { connectCommand } from "../cli/connect.ts";
import { hasCloudPublicConfig } from "../cloud/publicConfig.ts";
import { sharedServerCommandFlags } from "../cli/config.ts";
import {
  makeServeCommandForProduct,
  makeStartCommandForProduct,
  runServerCommandForProduct,
} from "../cli/server.ts";
import { projectCommand } from "../cli/project.ts";
import type { ExperimentalServerProductComposition } from "./ServerProductComposition.ts";
import type { ExperimentalServerProductEntry } from "./ServerProductEntry.ts";

export interface ExperimentalProductServerCliInput<
  Composition extends ExperimentalServerProductComposition = ExperimentalServerProductComposition,
> extends ExperimentalServerProductEntry<Composition> {}

const ProductServerCliRuntimeLayer = Layer.mergeAll(NodeServices.layer, NetService.layer);
const connectPublicConfigMissingMessage =
  "T3 Connect commands are unavailable: this build is missing T3 Connect public configuration.";

class ConnectPublicConfigMissingError extends CliError.UserError {
  override get message() {
    return connectPublicConfigMissingMessage;
  }
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

/** Creates the standard server CLI around one build-time product entry. */
export function makeExperimentalProductServerCli<
  const Input extends ExperimentalProductServerCliInput,
>(input: Input) {
  return Command.make(input.commandName ?? "t3", { ...sharedServerCommandFlags }).pipe(
    Command.withDescription(input.description ?? `Run the ${input.manifest.displayName} server.`),
    Command.withHandler((flags) => runServerCommandForProduct(flags, input)),
    Command.withSubcommands([
      makeStartCommandForProduct(input),
      makeServeCommandForProduct(input),
      authCommand,
      projectCommand,
      hasCloudPublicConfig ? connectCommand : connectUnavailableCommand,
    ]),
  );
}

/** Runs the standard Node server CLI for one build-time product entry. */
export function runExperimentalProductServerCli<
  const Input extends ExperimentalProductServerCliInput,
>(input: Input): void {
  Command.run(makeExperimentalProductServerCli(input), {
    version: input.manifest.version,
  }).pipe(Effect.scoped, Effect.provide(ProductServerCliRuntimeLayer), NodeRuntime.runMain);
}
