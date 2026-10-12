import type * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

import * as WebPushDeliveries from "./WebPushDeliveries.ts";

export const processMessage = Effect.fn("relay.web_push_delivery_queue.process_message")(function* (
  message: Cloudflare.Queues.Message<unknown>,
) {
  const deliveries = yield* WebPushDeliveries.WebPushDeliveries;
  yield* deliveries.process(message.body).pipe(
    Effect.matchEffect({
      onFailure: (error) =>
        Effect.gen(function* () {
          // Decide this message's outcome before Alchemy acknowledges the batch.
          // Cloudflare keeps the first ack/retry decision for each message.
          message.retry();
          yield* Effect.logWarning("Web push queue delivery failed; retrying message", {
            messageId: message.id,
            errorTag: error._tag,
          });
        }),
      onSuccess: () => Effect.sync(() => message.ack()),
    }),
  );
});
