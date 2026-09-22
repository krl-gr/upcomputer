import type { ProviderRuntimeEvent } from "@upcomputer/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Stream from "effect/Stream";

import { ProviderService } from "../provider/Services/ProviderService.ts";

export interface ExperimentalProviderRuntimeEventsShape {
  readonly stream: Stream.Stream<ProviderRuntimeEvent>;
}

export class ExperimentalProviderRuntimeEvents extends Context.Service<
  ExperimentalProviderRuntimeEvents,
  ExperimentalProviderRuntimeEventsShape
>()("@upcomputer/server/product/ProviderRuntimeEvents/ExperimentalProviderRuntimeEvents") {}

export const ExperimentalProviderRuntimeEventsLive = Layer.effect(
  ExperimentalProviderRuntimeEvents,
  Effect.map(ProviderService, ({ streamEvents }) => ({ stream: streamEvents })),
);
