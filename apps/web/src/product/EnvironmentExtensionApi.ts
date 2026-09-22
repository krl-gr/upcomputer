import type { EnvironmentId, ProductManifestSnapshot } from "@upcomputer/contracts";
import { EnvironmentSupervisor } from "@upcomputer/client-runtime/connection";
import {
  EnvironmentRpcUnavailableError,
  type WsRpcProtocolClient,
} from "@upcomputer/client-runtime/rpc";
import { createRuntimeCommand, runInEnvironment } from "@upcomputer/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentServerConfigsAtom } from "../state/server";
import { getInstalledWebProductComposition } from "./WebComposition";

const STABLE_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export interface EnvironmentExtensionApiDefinition<Api> {
  readonly id: string;
  /** Type-only marker; never present at runtime. */
  readonly _Api?: Api;
}

export type EnvironmentExtensionRpcRequest<Client extends WsRpcProtocolClient> = <A, E>(
  execute: (client: Client) => Effect.Effect<A, E, never>,
) => Promise<A>;

export interface ExperimentalEnvironmentExtensionApiFactory<
  Client extends WsRpcProtocolClient,
  Api,
> {
  readonly definition: EnvironmentExtensionApiDefinition<Api>;
  readonly create: (context: {
    readonly environmentId: EnvironmentId;
    readonly request: EnvironmentExtensionRpcRequest<Client>;
  }) => Api;
}

class EnvironmentExtensionRpcExecutionError extends Data.TaggedError(
  "EnvironmentExtensionRpcExecutionError",
)<{
  readonly cause: Cause.Cause<never>;
}> {}

interface ExtensionRpcRequestInput {
  readonly environmentId: EnvironmentId;
  readonly execute: (
    client: WsRpcProtocolClient,
  ) => Effect.Effect<unknown, EnvironmentExtensionRpcExecutionError, never>;
}

const extensionRpcRequestCommand = createRuntimeCommand(connectionAtomRuntime, {
  label: "web-extension-rpc-request",
  execute: (input: ExtensionRpcRequestInput) =>
    runInEnvironment(
      input.environmentId,
      Effect.gen(function* () {
        const supervisor = yield* EnvironmentSupervisor;
        const session = yield* SubscriptionRef.get(supervisor.session).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(
                  new EnvironmentRpcUnavailableError({
                    environmentId: input.environmentId,
                    message: `Environment ${input.environmentId} is not connected.`,
                  }),
                ),
              onSome: Effect.succeed,
            }),
          ),
        );
        return yield* input.execute(session.client);
      }),
    ),
});

let cachedComposition = getInstalledWebProductComposition();
const environmentExtensionApis = new Map<string, unknown>();

function extensionApiKey(environmentId: EnvironmentId, apiId: string): string {
  return `${environmentId}\u0000${apiId}`;
}

function currentComposition() {
  const composition = getInstalledWebProductComposition();
  if (composition !== cachedComposition) {
    cachedComposition = composition;
    environmentExtensionApis.clear();
  }
  return composition;
}

export function defineEnvironmentExtensionApi<Api>(
  id: string,
): EnvironmentExtensionApiDefinition<Api> {
  if (!STABLE_ID.test(id)) {
    throw new Error(`Environment extension API id '${id}' is invalid.`);
  }
  return { id };
}

export function readEnvironmentProductManifest(
  environmentId: EnvironmentId,
): ProductManifestSnapshot | null | undefined {
  const config = appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId);
  if (config === undefined) return undefined;
  return config.environment.product ?? null;
}

export async function requestEnvironmentExtensionRpc<Client extends WsRpcProtocolClient, A, E>(
  environmentId: EnvironmentId,
  execute: (client: Client) => Effect.Effect<A, E, never>,
): Promise<A> {
  const result = await extensionRpcRequestCommand.run(appAtomRegistry, {
    environmentId,
    execute: (client) =>
      (execute as (client: WsRpcProtocolClient) => Effect.Effect<unknown, E, never>)(client).pipe(
        Effect.catchCause((cause) =>
          Effect.fail(
            new EnvironmentExtensionRpcExecutionError({
              cause: cause as Cause.Cause<never>,
            }),
          ),
        ),
      ),
  });
  if (result._tag === "Success") {
    return result.value as A;
  }
  for (const reason of result.cause.reasons) {
    if (
      Cause.isFailReason(reason) &&
      reason.error instanceof EnvironmentExtensionRpcExecutionError
    ) {
      throw Cause.squash(reason.error.cause);
    }
  }
  throw Cause.squash(result.cause);
}

export function readEnvironmentExtensionApi<Api>(
  environmentId: EnvironmentId,
  definition: EnvironmentExtensionApiDefinition<Api>,
): Api | undefined {
  const key = extensionApiKey(environmentId, definition.id);
  if (environmentExtensionApis.has(key)) {
    return environmentExtensionApis.get(key) as Api;
  }

  const factory = currentComposition().rpc?.extensionApis.find((api) => api.id === definition.id);
  if (factory === undefined) {
    return undefined;
  }

  const api = factory.create({
    environmentId,
    request: (execute) => requestEnvironmentExtensionRpc(environmentId, execute),
  });
  environmentExtensionApis.set(key, api);
  return api as Api;
}

export function requireEnvironmentExtensionApi<Api>(
  environmentId: EnvironmentId,
  definition: EnvironmentExtensionApiDefinition<Api>,
): Api {
  const api = readEnvironmentExtensionApi(environmentId, definition);
  if (api === undefined) {
    throw new Error(
      `Environment extension API '${definition.id}' is unavailable for ${environmentId}.`,
    );
  }
  return api;
}
