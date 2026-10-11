import { EnvironmentHttpApi } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { HttpServerResponse } from "effect/http";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";

/*
 * Stand-ins for the handlers of upstream HTTP API groups the product hides
 * (`whenProductFeatureOr` in server.ts). The API keeps the group, so every
 * endpoint answers 404 as if the route did not exist.
 */

const notFound = () => Effect.succeed(HttpServerResponse.empty({ status: 404 }));

/** `mcpOAuth`: no OAuth metadata, client registration, sign-in or tokens for outside agents. */
export const hiddenMcpOAuthLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "mcpOAuth",
  (handlers) =>
    handlers
      .handleRaw("protectedResource", notFound)
      .handleRaw("mcpProtectedResource", notFound)
      .handleRaw("authorizationServer", notFound)
      .handleRaw("register", notFound)
      .handleRaw("authorize", notFound)
      .handleRaw("approval", notFound)
      .handleRaw("decision", notFound)
      .handleRaw("token", notFound),
);

/** `scheduledTaskWebhooks`: no webhook requests reach scheduled tasks. */
export const hiddenWebhooksLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "webhooks",
  (handlers) =>
    handlers
      .handleRaw("webhookPost", notFound)
      .handleRaw("webhookPut", notFound)
      .handleRaw("webhookPatch", notFound)
      .handleRaw("webhookGet", notFound),
);
