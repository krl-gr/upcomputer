import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as ErrorReporter from "effect/ErrorReporter";

import { ErrorTelemetry } from "../telemetry/ErrorTelemetry.ts";

// RpcServer reports typed failures too; log only defects and send them as `app.error`.
const makeReporter = (telemetry: ErrorTelemetry["Service"]): ErrorReporter.ErrorReporter => ({
  [ErrorReporter.TypeId]: ErrorReporter.TypeId,
  report: ({ cause, fiber }) => {
    for (const reason of cause.reasons) {
      if (reason._tag !== "Die" || ErrorReporter.isIgnored(reason.defect)) continue;
      Effect.runForkWith(fiber.context)(
        Effect.logError("Unhandled defect", Cause.fromReasons([reason])).pipe(
          Effect.andThen(telemetry.reportDefect(reason.defect)),
        ),
      );
    }
  },
});

export const layer = ErrorReporter.layer([
  Effect.gen(function* () {
    return makeReporter(yield* ErrorTelemetry);
  }),
]);
