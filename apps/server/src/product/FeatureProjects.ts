import { CommandId, ProjectId } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import { ServerConfig } from "../config.ts";
import { ProjectService } from "../project/ProjectService.ts";

/**
 * Project access for product features that keep a project of their own, such
 * as the tasks Inbox. Build it once inside a feature layer, where core
 * services are in context; the returned functions need nothing else.
 */
export const makeFeatureProjects = Effect.gen(function* () {
  const projects = yield* ProjectService;
  const config = yield* ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const crypto = yield* Crypto.Crypto;
  return {
    /** The T3 home: the server's base data directory. */
    homeDir: config.baseDir,
    /**
     * The active project rooted at `workspaceRoot`, or a new one with this
     * title. The folder is created when missing.
     */
    ensureProjectForWorkspaceRoot: (input: {
      readonly title: string;
      readonly workspaceRoot: string;
    }) =>
      Effect.gen(function* () {
        yield* fileSystem.makeDirectory(input.workspaceRoot, { recursive: true });
        const { project } = yield* projects.bootstrap({
          commandId: CommandId.make(yield* crypto.randomUUIDv4()),
          projectId: ProjectId.make(yield* crypto.randomUUIDv4()),
          title: input.title,
          workspaceRoot: input.workspaceRoot,
        });
        return project;
      }),
  };
});

export type FeatureProjects = Effect.Success<typeof makeFeatureProjects>;
