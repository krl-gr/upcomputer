import type * as Cloudflare from "@alchemy.run/cloudflare";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type * as WebPushDeliveries from "./WebPushDeliveries.ts";

export class WebPushDeliveryQueueSender extends Context.Service<
  WebPushDeliveryQueueSender,
  {
    readonly send: (
      body: WebPushDeliveries.WebPushDeliveryJob,
    ) => Effect.Effect<void, Cloudflare.Queues.SendError>;
  }
>()("t3code-relay/agentActivity/WebPushDeliveryQueueSender") {}
