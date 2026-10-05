import * as Effect from "effect/Effect";
import type { SqlError } from "effect/unstable/sql/SqlError";

import type { ExperimentalFeatureMigrationContribution } from "../product/FeatureMigrations.ts";
import ProjectionLinkedProjects from "./CoreFeatureMigrations/001_ProjectionLinkedProjects.ts";

/**
 * Schema that exists only in UpComputer. It is versioned in its own
 * `upcomputer.core` namespace of the feature migration ledger, so the core
 * migration list stays identical to upstream and upstream ids never collide
 * with fork-only ones. Names and versions match V1's, so a V1 database keeps
 * its history.
 */
export const CORE_FEATURE_MIGRATIONS: ExperimentalFeatureMigrationContribution<SqlError> = {
  ownerId: "upcomputer.core",
  namespace: "upcomputer.core",
  migrations: [
    { version: 1, name: "ProjectionLinkedProjects", run: ProjectionLinkedProjects },
    // V1 stored the thread's unlink pin in a column; v2 keeps it in the thread record.
    { version: 2, name: "ProjectionThreadProjectLinksPinned", run: Effect.void },
  ],
};
