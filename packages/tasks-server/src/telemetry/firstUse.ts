import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import {
  AnalyticsService,
  type TelemetryMilestone,
} from "../../../../apps/server/src/extensionApi.ts";

/** Whether the person did it in the app or asked an agent, which used a task tool. */
export type FirstUseVia = "app" | "agent";

/**
 * Records an install's first use of a feature. Analytics is a core runtime
 * service, so it is absent only where a test builds the feature on its own.
 */
export const makeFirstUseRecorder = Effect.map(
  Effect.serviceOption(AnalyticsService),
  (analytics) => (event: TelemetryMilestone, properties?: { readonly via?: FirstUseVia }) =>
    Option.match(analytics, {
      onNone: () => Effect.void,
      onSome: (service) => service.recordMilestone(event, properties),
    }),
);
