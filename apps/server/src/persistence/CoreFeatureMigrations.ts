import type { SqlError } from "effect/unstable/sql/SqlError";

import type { ExperimentalFeatureMigrationContribution } from "../product/FeatureMigrations.ts";
import ProjectionLinkedProjects from "./CoreFeatureMigrations/001_ProjectionLinkedProjects.ts";

/**
 * Schema that exists only in UpComputer. It is versioned in its own
 * `upcomputer.core` namespace so the core migration list stays identical to
 * upstream and upstream migrations never collide with fork-only ids.
 */
export const CORE_FEATURE_MIGRATIONS: ExperimentalFeatureMigrationContribution<SqlError> = {
  ownerId: "upcomputer.core",
  namespace: "upcomputer.core",
  migrations: [{ version: 1, name: "ProjectionLinkedProjects", run: ProjectionLinkedProjects }],
};
