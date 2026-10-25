import { RelayApi } from "@t3tools/contracts/relay";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpApiClient from "effect/http-api/HttpApiClient";

import { observeRelayResponseDate } from "../cloud/RelayClock.ts";

export const makeRelayEnvironmentClient = (connection: {
  readonly url: string;
  readonly environmentCredential: string;
}) =>
  HttpApiClient.make(RelayApi, {
    baseUrl: connection.url,
    transformClient: (client) =>
      client.pipe(
        HttpClient.mapRequest(
          HttpClientRequest.setHeader(
            "authorization",
            `Bearer ${connection.environmentCredential}`,
          ),
        ),
        HttpClient.tap(observeRelayResponseDate),
      ),
  }).pipe(Effect.provide(FetchHttpClient.layer));
