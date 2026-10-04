import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ServerSettingsService } from "../../../../apps/server/src/extensionApi.ts";

/**
 * Where the "all chats" instructions live: the core `customInstructions`
 * server setting, which core adds to every provider session. Their history
 * is kept with the other instruction fields in TaskPromptSettingsStore.
 */
export interface AllChatsInstructionsShape {
  readonly get: Effect.Effect<string, AllChatsInstructionsError>;
  readonly set: (text: string) => Effect.Effect<void, AllChatsInstructionsError>;
}

export interface AllChatsInstructionsError {
  readonly _tag: "AllChatsInstructionsError";
  readonly message: string;
}

export class AllChatsInstructions extends Context.Service<
  AllChatsInstructions,
  AllChatsInstructionsShape
>()("@t3tools/tasks-server/persistence/AllChatsInstructions") {}

const settingsError = (cause: unknown): AllChatsInstructionsError => ({
  _tag: "AllChatsInstructionsError",
  message: `Could not access the all-chats instructions setting: ${
    cause instanceof Error ? cause.message : String(cause)
  }`,
});

export const AllChatsInstructionsLive = Layer.effect(
  AllChatsInstructions,
  Effect.gen(function* () {
    const settings = yield* ServerSettingsService;
    return {
      get: settings.getSettings.pipe(
        Effect.map((value) => value.customInstructions),
        Effect.mapError(settingsError),
      ),
      set: (text) =>
        settings
          .updateSettings({ customInstructions: text })
          .pipe(Effect.asVoid, Effect.mapError(settingsError)),
    };
  }),
);
