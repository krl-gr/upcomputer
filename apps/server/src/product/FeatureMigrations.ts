import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const STABLE_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export interface ExperimentalFeatureMigration<E = never> {
  readonly version: number;
  readonly name: string;
  readonly run: Effect.Effect<void, E, SqlClient.SqlClient>;
}

export interface ExperimentalFeatureMigrationContribution<E = never> {
  readonly ownerId: string;
  readonly namespace: string;
  readonly migrations: ReadonlyArray<ExperimentalFeatureMigration<E>>;
}

export interface ExperimentalFeatureMigrationIdentity {
  readonly ownerId: string;
  readonly namespace: string;
  readonly version: number;
  readonly name: string;
}

export type FeatureMigrationErrorCode =
  | "invalid-owner-id"
  | "invalid-namespace"
  | "duplicate-namespace"
  | "invalid-version"
  | "invalid-name"
  | "duplicate-version"
  | "non-contiguous-versions"
  | "history-owner-mismatch"
  | "history-name-mismatch"
  | "history-ahead";

export class FeatureMigrationError extends Error {
  override readonly name = "FeatureMigrationError";
  readonly code: FeatureMigrationErrorCode;
  readonly namespace: string | undefined;
  readonly version: number | undefined;

  constructor(
    code: FeatureMigrationErrorCode,
    message: string,
    namespace?: string,
    version?: number,
  ) {
    super(message);
    this.code = code;
    this.namespace = namespace;
    this.version = version;
  }
}

export interface ExperimentalPlannedFeatureMigration<
  E,
> extends ExperimentalFeatureMigrationIdentity {
  readonly run: Effect.Effect<void, E, SqlClient.SqlClient>;
}

interface AppliedFeatureMigrationRow {
  readonly namespace: string;
  readonly version: number;
  readonly name: string;
  readonly ownerId: string;
}

export function createExperimentalFeatureMigrationPlan<E>(
  contributions: ReadonlyArray<ExperimentalFeatureMigrationContribution<E>>,
): ReadonlyArray<ExperimentalPlannedFeatureMigration<E>> {
  const namespaces = new Map<string, string>();
  const plan: ExperimentalPlannedFeatureMigration<E>[] = [];

  for (const contribution of contributions) {
    if (!STABLE_ID.test(contribution.ownerId)) {
      throw new FeatureMigrationError(
        "invalid-owner-id",
        `Feature migration owner '${contribution.ownerId}' must be a lowercase dot, dash, or underscore separated identifier.`,
        contribution.namespace,
      );
    }
    if (!STABLE_ID.test(contribution.namespace)) {
      throw new FeatureMigrationError(
        "invalid-namespace",
        `Feature migration namespace '${contribution.namespace}' must be a lowercase dot, dash, or underscore separated identifier.`,
        contribution.namespace,
      );
    }

    const existingOwner = namespaces.get(contribution.namespace);
    if (existingOwner !== undefined) {
      throw new FeatureMigrationError(
        "duplicate-namespace",
        `Feature migration namespace '${contribution.namespace}' is already owned by '${existingOwner}'.`,
        contribution.namespace,
      );
    }
    namespaces.set(contribution.namespace, contribution.ownerId);

    const versions = new Set<number>();
    const migrations = [...contribution.migrations].sort(
      (left, right) => left.version - right.version,
    );
    for (const migration of migrations) {
      if (!Number.isInteger(migration.version) || migration.version <= 0) {
        throw new FeatureMigrationError(
          "invalid-version",
          `Feature migration '${contribution.namespace}' has invalid version '${migration.version}'.`,
          contribution.namespace,
          migration.version,
        );
      }
      if (migration.name.trim().length === 0) {
        throw new FeatureMigrationError(
          "invalid-name",
          `Feature migration '${contribution.namespace}' version ${migration.version} must have a non-empty name.`,
          contribution.namespace,
          migration.version,
        );
      }
      if (versions.has(migration.version)) {
        throw new FeatureMigrationError(
          "duplicate-version",
          `Feature migration '${contribution.namespace}' version ${migration.version} is registered more than once.`,
          contribution.namespace,
          migration.version,
        );
      }
      versions.add(migration.version);
      plan.push({
        ownerId: contribution.ownerId,
        namespace: contribution.namespace,
        version: migration.version,
        name: migration.name,
        run: migration.run,
      });
    }

    for (let expectedVersion = 1; expectedVersion <= migrations.length; expectedVersion += 1) {
      if (!versions.has(expectedVersion)) {
        throw new FeatureMigrationError(
          "non-contiguous-versions",
          `Feature migration namespace '${contribution.namespace}' must be contiguous from version 1; version ${expectedVersion} is missing.`,
          contribution.namespace,
          expectedVersion,
        );
      }
    }
  }

  return plan.sort(
    (left, right) => left.namespace.localeCompare(right.namespace) || left.version - right.version,
  );
}

export const runExperimentalFeatureMigrations = Effect.fn("runExperimentalFeatureMigrations")(
  function* <E>(contributions: ReadonlyArray<ExperimentalFeatureMigrationContribution<E>>) {
    const plan = createExperimentalFeatureMigrationPlan(contributions);
    const sql = yield* SqlClient.SqlClient;

    yield* sql`
      CREATE TABLE IF NOT EXISTS feature_migration_history (
        namespace TEXT NOT NULL,
        version INTEGER NOT NULL,
        name TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (namespace, version)
      )
    `;

    const appliedRows = yield* sql<AppliedFeatureMigrationRow>`
      SELECT namespace, version, name, owner_id AS "ownerId"
      FROM feature_migration_history
      ORDER BY namespace ASC, version ASC
    `;
    const appliedByIdentity = new Map(
      appliedRows.map((row) => [`${row.namespace}:${row.version}`, row] as const),
    );
    const plannedByIdentity = new Map(
      plan.map((migration) => [`${migration.namespace}:${migration.version}`, migration] as const),
    );
    const activeNamespaces = new Set(contributions.map(({ namespace }) => namespace));

    for (const row of appliedRows) {
      if (!activeNamespaces.has(row.namespace)) continue;
      const planned = plannedByIdentity.get(`${row.namespace}:${row.version}`);
      if (planned === undefined) {
        return yield* Effect.fail(
          new FeatureMigrationError(
            "history-ahead",
            `Database migration history for '${row.namespace}' is ahead of the registered feature at version ${row.version}.`,
            row.namespace,
            row.version,
          ),
        );
      }
      if (planned.ownerId !== row.ownerId) {
        return yield* Effect.fail(
          new FeatureMigrationError(
            "history-owner-mismatch",
            `Feature migration namespace '${row.namespace}' is recorded for owner '${row.ownerId}', not '${planned.ownerId}'.`,
            row.namespace,
            row.version,
          ),
        );
      }
      if (planned.name !== row.name) {
        return yield* Effect.fail(
          new FeatureMigrationError(
            "history-name-mismatch",
            `Feature migration '${row.namespace}' version ${row.version} was recorded as '${row.name}', not '${planned.name}'.`,
            row.namespace,
            row.version,
          ),
        );
      }
    }

    const executed: ExperimentalFeatureMigrationIdentity[] = [];
    for (const migration of plan) {
      if (appliedByIdentity.has(`${migration.namespace}:${migration.version}`)) continue;

      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* migration.run;
          yield* sql`
            INSERT INTO feature_migration_history (
              namespace,
              version,
              name,
              owner_id
            ) VALUES (
              ${migration.namespace},
              ${migration.version},
              ${migration.name},
              ${migration.ownerId}
            )
          `;
        }),
      );
      executed.push({
        ownerId: migration.ownerId,
        namespace: migration.namespace,
        version: migration.version,
        name: migration.name,
      });
    }

    return executed;
  },
);
