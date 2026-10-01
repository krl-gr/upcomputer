import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@upcomputer/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotQueryShape,
} from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { BUILT_IN_INTERACTION_MODE_REGISTRY } from "../product/BuiltInInteractionModes.ts";
import { resolveMcpToolSession } from "./registerContributedTools.ts";

const threadId = ThreadId.make("thread-removed-mode");
const invocation = {
  environmentId: EnvironmentId.make("environment-removed-mode"),
  threadId,
  providerSessionId: "provider-session-removed-mode",
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities: new Set(["preview"] as const),
  issuedAt: 1,
  expiresAt: Number.MAX_SAFE_INTEGER,
};

const projectionWithThreadMode = (interactionMode: string) =>
  ({
    getThreadShellById: () =>
      Effect.succeed(Option.some({ id: threadId, runtimeMode: "full-access", interactionMode })),
  }) as unknown as ProjectionSnapshotQueryShape;

it.effect("applies Default to tools called from a thread in a removed mode", () =>
  Effect.gen(function* () {
    const session = yield* resolveMcpToolSession(
      invocation,
      BUILT_IN_INTERACTION_MODE_REGISTRY,
    ).pipe(
      Effect.provideService(ProjectionSnapshotQuery, projectionWithThreadMode("orchestrator")),
    );

    expect(session.interactionMode?.id).toBe("default");
    expect(session.mutationPolicy).toBe("allow");
  }),
);

it.effect("keeps the policy of a registered mode", () =>
  Effect.gen(function* () {
    const session = yield* resolveMcpToolSession(
      invocation,
      BUILT_IN_INTERACTION_MODE_REGISTRY,
    ).pipe(Effect.provideService(ProjectionSnapshotQuery, projectionWithThreadMode("ask")));

    expect(session.interactionMode?.id).toBe("ask");
    expect(session.mutationPolicy).toBe("deny");
  }),
);
