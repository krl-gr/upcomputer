import * as NodeOS from "node:os";
import * as Effect from "effect/Effect";
import {
  acquireProfileOwnership,
  profileOwnershipDirectory,
  ProfileOwnershipError,
} from "@upcomputer/shared/profileOwnership";

/** CLI scope must outlive config reads, SQLite, agents, and command finalizers. */
export const acquireCliProfileOwnership = Effect.fn("acquireCliProfileOwnership")(function* () {
  return yield* Effect.acquireRelease(
    Effect.try({
      try: () =>
        acquireProfileOwnership(profileOwnershipDirectory(NodeOS.homedir()), "application"),
      catch: (error) =>
        error instanceof ProfileOwnershipError ? error : new ProfileOwnershipError("unavailable"),
    }),
    (lease) => Effect.sync(() => lease.release()),
  );
});
