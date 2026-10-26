import type * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

import * as WebPushDeliveries from "./WebPushDeliveries.ts";

export const processMessage = Effect.fn("relay.web_push_delivery_queue.process_message")(function* (
  message: Cloudflare.Queues.Message<unknown>,
) {
  const deliveries = yield* WebPushDeliveries.WebPushDeliveries;
  yield* deliveries.process(message.body).pipe(
    Effect.matchEffect({
      // The enclosing operation owns the span for this inline handler.
      onFailure: Effect.fnUntraced(function* (error) {
        // Cloudflare keeps the first ack/retry decision; decide before Alchemy acknowledges the batch.
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
