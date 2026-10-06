/**
 * `t3 cutover-v1` - moves an UpComputer V1 home onto v2, once, with the app
 * closed. The server does the same on its first start on a V1 home; this is
 * the manual way, and the retry after a failed cutover. It backs up first and
 * prints the command that undoes it. See `upcomputerCutover/V1Cutover.ts`.
 */
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { Command, Flag } from "effect/unstable/cli";

import { expandHomePath } from "../os-jank.ts";
import { ServerProduct } from "../product/ServerProduct.ts";
import { runV1Cutover } from "../upcomputerCutover/V1Cutover.ts";

export const cutoverV1Command = Command.make("cutover-v1", {
  baseDir: Flag.String("base-dir").pipe(
    Flag.withDescription(
      "The Up.computer home to move onto v2, for example ~/.upcomputer. Required, so a checkout never picks its own dev home.",
    ),
  ),
  v1Home: Flag.String("v1-home").pipe(
    Flag.withDescription(
      "The home V1's stored paths name, when --base-dir holds a copy (a dry run). Defaults to --base-dir.",
    ),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription(
    "Move an UpComputer V1 home onto v2: back up, migrate, import, and write a report.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const product = yield* ServerProduct;
      const homeDir = yield* expandHomePath(flags.baseDir);
      const v1HomeDir = Option.isSome(flags.v1Home)
        ? yield* expandHomePath(flags.v1Home.value)
        : undefined;
      const outcome = yield* runV1Cutover({
        homeDir,
        v1HomeDir,
        featureMigrations: product.features.flatMap((feature) => feature.migrations ?? []),
        now: yield* DateTime.now,
        log: (line) => Console.log(line),
      }).pipe(Effect.result);
      if (Result.isFailure(outcome)) {
        yield* Console.error(`\n${outcome.failure.message}\n`);
        process.exitCode = 1;
        return;
      }
      const { report, reportPath } = outcome.success;
      yield* Console.log(
        [
          "",
          "Cutover done. All checks passed.",
          `Report: ${reportPath}`,
          `To undo it, quit Up.computer and run: ${report.restoreCommand}`,
          "",
        ].join("\n"),
      );
    }),
  ),
);
