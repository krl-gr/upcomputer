import { type ServerConfig, WS_METHODS } from "@upcomputer/contracts";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";
import * as RpcClient from "effect/unstable/rpc/RpcClient";
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization";
import * as Socket from "effect/unstable/socket/Socket";

import { makeWsRpcProtocolClient, type WsRpcProtocolClient } from "./protocol.ts";
import type {
  ConnectionAttemptError,
  ConnectionTransientError,
  PreparedConnection,
} from "../connection/model.ts";
import {
  ConnectionBlockedError,
  ConnectionTransientError as ConnectionTransientErrorClass,
} from "../connection/model.ts";

const SOCKET_OPEN_TIMEOUT = "15 seconds";

export type RpcSessionClientFactory<Client extends WsRpcProtocolClient = WsRpcProtocolClient> =
  () => Effect.Effect<Client, Error, RpcClient.Protocol | Scope.Scope>;

export interface RpcSessionLayerOptions {
  readonly clientFactory?: RpcSessionClientFactory;
  readonly resolveClientFactory?: () => RpcSessionClientFactory | undefined;
}

export interface RpcSession {
  readonly client: WsRpcProtocolClient;
  readonly initialConfig: Effect.Effect<ServerConfig, ConnectionAttemptError>;
  readonly ready: Effect.Effect<void, ConnectionAttemptError>;
  readonly probe: Effect.Effect<void, ConnectionAttemptError>;
  readonly closed: Effect.Effect<never, ConnectionTransientError>;
}

export class RpcSessionFactory extends Context.Service<
  RpcSessionFactory,
  {
    readonly connect: (
      connection: PreparedConnection,
    ) => Effect.Effect<RpcSession, ConnectionAttemptError, Scope.Scope>;
  }
>()("@upcomputer/client-runtime/rpc/session/RpcSessionFactory") {}

function resolveClientFactory(options: RpcSessionLayerOptions): RpcSessionClientFactory {
  return (
    options.resolveClientFactory?.() ?? options.clientFactory ?? (() => makeWsRpcProtocolClient)
  );
}

type InitialConfigError = Effect.Error<
  ReturnType<WsRpcProtocolClient[typeof WS_METHODS.serverGetConfig]>
>;
type ProbeError = Effect.Error<ReturnType<WsRpcProtocolClient[typeof WS_METHODS.serverProbe]>>;

function mapClientFactoryError(error: Error): ConnectionAttemptError {
  return new ConnectionTransientErrorClass({
    reason: "transport",
    detail: error.message,
  });
}

function mapSessionRpcError(error: InitialConfigError | ProbeError): ConnectionAttemptError {
  switch (error._tag) {
    case "EnvironmentAuthorizationError":
      return new ConnectionBlockedError({
        reason: "permission",
        detail: error.message,
      });
    case "KeybindingsConfigParseError":
    case "ServerSettingsError":
      return new ConnectionTransientErrorClass({
        reason: "remote-unavailable",
        detail: error.message,
      });
    case "RpcClientError":
      return new ConnectionTransientErrorClass({
        reason: "transport",
        detail: error.message,
      });
  }
}

export const make = (options: RpcSessionLayerOptions = {}) =>
  Effect.gen(function* () {
    const webSocketConstructor = yield* Socket.WebSocketConstructor;

    const connect = Effect.fnUntraced(function* (connection: PreparedConnection) {
      yield* Effect.annotateCurrentSpan({
        "connection.environment.id": connection.environmentId,
      });

      const connected = yield* Deferred.make<void>();
      const disconnected = yield* Deferred.make<never, ConnectionTransientError>();
      const hooks = RpcClient.ConnectionHooks.of({
        onConnect: Deferred.succeed(connected, undefined).pipe(Effect.asVoid),
        onDisconnect: Deferred.isDone(connected).pipe(
          Effect.flatMap((wasConnected) =>
            Deferred.fail(
              disconnected,
              new ConnectionTransientErrorClass({
                reason: "transport",
                detail: wasConnected
                  ? `${connection.label} disconnected.`
                  : `${connection.label} could not establish a WebSocket connection.`,
              }),
            ),
          ),
          Effect.asVoid,
        ),
      });
      const socketLayer = Socket.layerWebSocket(connection.socketUrl, {
        openTimeout: SOCKET_OPEN_TIMEOUT,
      }).pipe(Layer.provide(Layer.succeed(Socket.WebSocketConstructor, webSocketConstructor)));
      const protocolLayer = Layer.effect(
        RpcClient.Protocol,
        RpcClient.makeProtocolSocket({
          retryTransientErrors: false,
          retryPolicy: Schedule.recurs(0),
        }),
      ).pipe(
        Layer.provide(
          Layer.mergeAll(
            socketLayer,
            RpcSerialization.layerJson,
            Layer.succeed(RpcClient.ConnectionHooks, hooks),
          ),
        ),
      );
      const protocolContext = yield* Layer.build(protocolLayer).pipe(
        Effect.withSpan("environment.websocket.connect"),
      );
      const client = yield* resolveClientFactory(options)().pipe(
        Effect.provide(protocolContext),
        Effect.mapError(mapClientFactoryError),
      );
      const initialConfig = yield* Effect.cached(
        client[WS_METHODS.serverGetConfig]({}).pipe(
          Effect.mapError(mapSessionRpcError),
          Effect.withSpan("environment.initialSync"),
        ),
      );
      // Servers older than the connectionProbe capability have no serverProbe
      // method, so the config call doubles as the liveness probe there.
      const probe = initialConfig.pipe(
        Effect.flatMap((config) =>
          (config.environment.capabilities.connectionProbe === true
            ? client[WS_METHODS.serverProbe]({})
            : client[WS_METHODS.serverGetConfig]({})
          ).pipe(Effect.mapError(mapSessionRpcError)),
        ),
        Effect.asVoid,
        Effect.withSpan("clientRuntime.connection.rpcSession.probe"),
      );

      return {
        client,
        initialConfig,
        ready: Deferred.await(connected).pipe(
          Effect.andThen(initialConfig),
          Effect.asVoid,
          Effect.raceFirst(Deferred.await(disconnected)),
        ),
        probe,
        closed: Deferred.await(disconnected),
      } satisfies RpcSession;
    });

    return RpcSessionFactory.of({ connect });
  });

export const layerWithOptions = (options: RpcSessionLayerOptions = {}) =>
  Layer.effect(RpcSessionFactory, make(options));

export const layer = layerWithOptions();
