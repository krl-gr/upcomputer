import { setUserInstructions } from "@t3tools/provider-core/server/userInstructions";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { ServerSettingsService } from "../serverSettings.ts";

/**
 * Keeps the user's "all chats" instructions block that every provider session
 * gets (`@t3tools/provider-core/server/userInstructions`) in sync with the
 * settings file, including edits made outside the app.
 */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const settings = yield* ServerSettingsService;
    const changes = yield* settings.subscribeChanges;
    const initial = yield* settings.getSettings.pipe(
      Effect.map((value) => value.customInstructions),
      Effect.catch((cause) =>
        Effect.logWarning("user instructions unavailable", { cause }).pipe(Effect.as("")),
      ),
    );
    setUserInstructions(initial);
    yield* changes.pipe(
      Stream.runForEach((value) =>
        Effect.sync(() => setUserInstructions(value.customInstructions)),
      ),
      Effect.forkScoped,
    );
  }),
);
