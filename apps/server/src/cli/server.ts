import * as Effect from "effect/Effect";
import { Command, GlobalFlag } from "effect/unstable/cli";

import { ServerConfig, type StartupPresentation } from "../config.ts";
import { CORE_SERVER_PRODUCT_ENTRY } from "../product/defaultProductEntry.ts";
import type { ExperimentalServerProductEntry } from "../product/ServerProductEntry.ts";
import { runServerForProduct } from "../server.ts";
import { type CliServerFlags, resolveServerConfig, sharedServerCommandFlags } from "./config.ts";

export const runServerCommandForProduct = <
  const ProductEntry extends ExperimentalServerProductEntry,
>(
  flags: CliServerFlags,
  productEntry: ProductEntry,
  options?: {
    readonly startupPresentation?: StartupPresentation;
    readonly forceAutoBootstrapProjectFromCwd?: boolean;
  },
) =>
  Effect.gen(function* () {
    const logLevel = yield* GlobalFlag.LogLevel;
    const config = yield* resolveServerConfig(flags, logLevel, options);
    return yield* runServerForProduct(productEntry).pipe(
      Effect.provideService(ServerConfig, config),
    );
  });

export const runServerCommand = (
  flags: CliServerFlags,
  options?: {
    readonly startupPresentation?: StartupPresentation;
    readonly forceAutoBootstrapProjectFromCwd?: boolean;
  },
) => runServerCommandForProduct(flags, CORE_SERVER_PRODUCT_ENTRY, options);

export const makeStartCommandForProduct = <
  const ProductEntry extends ExperimentalServerProductEntry,
>(
  productEntry: ProductEntry,
) =>
  Command.make("start", { ...sharedServerCommandFlags }).pipe(
    Command.withDescription(`Run the ${productEntry.manifest.displayName} server.`),
    Command.withHandler((flags) => runServerCommandForProduct(flags, productEntry)),
  );

export const makeStartCommand = makeStartCommandForProduct;

export const makeServeCommandForProduct = <
  const ProductEntry extends ExperimentalServerProductEntry,
>(
  productEntry: ProductEntry,
) =>
  Command.make("serve", { ...sharedServerCommandFlags }).pipe(
    Command.withDescription(
      `Run the ${productEntry.manifest.displayName} server without opening a browser and print headless pairing details.`,
    ),
    Command.withHandler((flags) =>
      runServerCommandForProduct(flags, productEntry, {
        startupPresentation: "headless",
        forceAutoBootstrapProjectFromCwd: false,
      }),
    ),
  );

export const makeServeCommand = makeServeCommandForProduct;

export const startCommand = makeStartCommand(CORE_SERVER_PRODUCT_ENTRY);

export const serveCommand = makeServeCommand(CORE_SERVER_PRODUCT_ENTRY);
