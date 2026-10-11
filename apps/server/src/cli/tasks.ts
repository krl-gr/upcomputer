/**
 * `t3 tasks import-wande` - imports one person's wande data (a Convex
 * snapshot export) as person tasks, routines and schedule entries. It works on
 * the database directly, so the real import needs the server for that home
 * stopped; `--dry-run` only reads and prints the plan.
 */
import {
  folderNameForTitle,
  formatWandeImportReport,
  importWande,
  WANDE_TABLES,
  WandeImportServicesLive,
  type WandeSnapshotTables,
  type WandeTable,
} from "@t3tools/tasks-server/import";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as References from "effect/References";
import { Command, Flag, GlobalFlag } from "effect/cli";
import * as CliError from "effect/cli/CliError";

import * as ServerConfig from "../config.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import { expandHomePath } from "../os-jank.ts";
import { runExperimentalFeatureMigrations } from "../product/FeatureMigrations.ts";
import { ServerProduct } from "../product/ServerProduct.ts";
import { isProcessAlive, readPersistedServerRuntimeState } from "../serverRuntimeState.ts";
import { openZipArchive } from "../zipArchive.ts";
import { resolveCliAuthConfig } from "./config.ts";
import { layerProjectCliRuntime } from "./project.ts";

const userError = (message: string) => new CliError.UserError({ cause: message });

/** Each needed table's `documents.jsonl`, from an extracted export folder or its ZIP. */
const readSnapshot = Effect.fn("readWandeSnapshot")(function* (snapshotPath: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const info = yield* fs
    .stat(snapshotPath)
    .pipe(Effect.mapError(() => userError(`No snapshot at ${snapshotPath}.`)));
  const tables: Partial<Record<WandeTable, string>> = {};
  if (info.type === "Directory") {
    for (const table of WANDE_TABLES) {
      const file = path.join(snapshotPath, table, "documents.jsonl");
      tables[table] = yield* fs
        .readFileString(file)
        .pipe(Effect.mapError(() => userError(`The snapshot has no ${file}.`)));
    }
  } else {
    yield* Effect.scoped(
      Effect.gen(function* () {
        const archive = yield* openZipArchive(snapshotPath, (detail) =>
          userError(`${detail} (${snapshotPath})`),
        );
        for (let entry = yield* archive.next; entry !== null; entry = yield* archive.next) {
          const name = entry.fileName;
          const table = WANDE_TABLES.find(
            (candidate) =>
              name === `${candidate}/documents.jsonl` ||
              name.endsWith(`/${candidate}/documents.jsonl`),
          );
          if (table === undefined) continue;
          const readable = yield* archive.streamEntry(entry);
          tables[table] = yield* Effect.tryPromise({
            try: async () => {
              const chunks: Buffer[] = [];
              for await (const chunk of readable) chunks.push(chunk as Buffer);
              return Buffer.concat(chunks).toString("utf8");
            },
            catch: () => userError(`Could not read ${name} from ${snapshotPath}.`),
          });
        }
      }),
    );
  }
  const missing = WANDE_TABLES.filter((table) => tables[table] === undefined);
  if (missing.length > 0) {
    return yield* userError(`The snapshot has no ${missing.join(", ")} table.`);
  }
  return tables as WandeSnapshotTables;
});

const importWandeCommand = Command.make("import-wande", {
  baseDir: Flag.String("base-dir").pipe(
    Flag.withDescription(
      "The Up.computer home to import into, for example ~/.upcomputer. Required, so a checkout never picks its own dev home.",
    ),
  ),
  snapshot: Flag.String("snapshot").pipe(
    Flag.withDescription("The Convex snapshot export: its ZIP or the extracted folder."),
  ),
  email: Flag.String("email").pipe(
    Flag.withDescription("Import only the wande user with this email."),
  ),
  projectsDir: Flag.String("projects-dir").pipe(
    Flag.withDescription(
      "Folder that holds a project per wande project, named by its title. Default: ~/Projects.",
    ),
    Flag.optional,
  ),
  project: Flag.String("project").pipe(
    Flag.withDescription(
      'Put a wande project in another folder: "<wande title>=<folder>", relative to --projects-dir unless absolute. Two titles on one folder share a project. Repeat as needed.',
    ),
    Flag.atLeast(0),
  ),
  dryRun: Flag.Boolean("dry-run").pipe(
    Flag.withDescription("Print the plan without writing anything."),
    Flag.withDefault(false),
  ),
}).pipe(
  Command.withDescription(
    "Import a person's wande tasks, routines and schedule from a Convex snapshot. A rerun only adds what is missing.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const product = yield* ServerProduct;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = path.resolve(yield* expandHomePath(flags.baseDir));
      const { dbPath } = yield* ServerConfig.deriveServerPaths(baseDir, undefined, {
        baseDirIsExplicit: true,
      });
      // A mistyped home must not get a fresh, empty database.
      if (!(yield* fs.exists(dbPath))) {
        return yield* userError(`No Up.computer database at ${dbPath}.`);
      }
      const config = yield* resolveCliAuthConfig(
        { baseDir: Option.some(baseDir) },
        yield* GlobalFlag.LogLevel,
      );
      if (!flags.dryRun) {
        const runtime = yield* readPersistedServerRuntimeState(config.serverRuntimeStatePath);
        if (Option.isSome(runtime) && runtime.value.pid > 0 && isProcessAlive(runtime.value.pid)) {
          return yield* userError(
            `An Up.computer server is running for ${baseDir} (pid ${runtime.value.pid}). Quit Up.computer or stop that server, then run the import again. --dry-run works while it runs.`,
          );
        }
      }

      const projectsDir = path.resolve(
        yield* expandHomePath(Option.getOrElse(flags.projectsDir, () => "~/Projects")),
      );
      const folders = new Map<string, string>();
      for (const mapping of flags.project) {
        const at = mapping.lastIndexOf("=");
        const title = mapping.slice(0, at).trim();
        const folder = mapping.slice(at + 1).trim();
        if (at < 0 || title === "" || folder === "") {
          return yield* userError(`--project takes "<wande title>=<folder>", not "${mapping}".`);
        }
        folders.set(title.toLowerCase(), path.resolve(projectsDir, yield* expandHomePath(folder)));
      }

      const tables = yield* readSnapshot(path.resolve(yield* expandHomePath(flags.snapshot)));
      const runtime = WandeImportServicesLive.pipe(
        Layer.provideMerge(ProjectStore.layer),
        Layer.provideMerge(
          Layer.effectDiscard(
            runExperimentalFeatureMigrations(
              product.features.flatMap((feature) => feature.migrations ?? []),
            ),
          ),
        ),
        Layer.provideMerge(layerProjectCliRuntime),
        Layer.provideMerge(ServerConfig.layer(config)),
        Layer.provide(Layer.succeed(References.MinimumLogLevel, config.logLevel)),
      );
      const report = yield* importWande({
        tables,
        email: flags.email,
        rootFor: (title) =>
          folders.get(title.trim().toLowerCase()) ??
          path.join(projectsDir, folderNameForTitle(title)),
        dryRun: flags.dryRun,
      }).pipe(Effect.provide(runtime));
      yield* Console.log(formatWandeImportReport(report));
    }),
  ),
);

export const tasksCommand = Command.make("tasks").pipe(
  Command.withDescription("Task system tools."),
  Command.withSubcommands([importWandeCommand]),
);
