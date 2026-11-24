// Opens a terminal in the calling agent's thread with a provider's sign-in command typed in,
// the way the Welcome page does. The user reviews it and presses Enter themselves.
import { PROVIDER_DISPLAY_NAMES, type ServerProvider, type ThreadId } from "@t3tools/contracts";
import {
  providerSignInTerminalId,
  resolveProviderSignInCommand,
} from "@t3tools/shared/providerSignIn";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { ServerConfig } from "../config.ts";
import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
import { ThreadViewers } from "../orchestration-v2/ThreadViewers.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { TerminalManager } from "../terminal/Manager.ts";
import { ProviderInstallation } from "./providerInstallation.ts";
import { ProviderRegistry } from "./ProviderRegistry.ts";

const SETTINGS_PATH = "Settings, Providers, Connect your agents";

export const ProviderSignInResult = Schema.Struct({
  status: Schema.Literals(["opened", "alreadyOpen", "appSetup", "signedIn", "useSettings"]),
  provider: Schema.String,
  instanceId: Schema.String,
  command: Schema.optionalKey(Schema.String),
  /** Set when this call opened the terminal; clients show it under the call while it is open. */
  signInTerminalId: Schema.optionalKey(Schema.String),
  /** Set for a provider the app installs and signs in itself; clients show its setup under the call. */
  appSetupInstanceId: Schema.optionalKey(Schema.String),
  message: Schema.String,
});
export type ProviderSignInResult = typeof ProviderSignInResult.Type;

export class ProviderSignInError extends Schema.TaggedError<ProviderSignInError>()(
  "ProviderSignInError",
  {
    reason: Schema.Literals([
      "unknown_provider",
      "disabled",
      "not_installed",
      "no_window",
      "terminal_failed",
      "install_failed",
    ]),
    message: Schema.String,
  },
) {}

export class ProviderSignIn extends Context.Service<
  ProviderSignIn,
  {
    /**
     * Refreshes the provider's status first: a signed-in provider opens nothing, and a call
     * after the user finished reports that. A shell the command was already typed into is
     * left as it is.
     */
    readonly signIn: (input: {
      readonly threadId: ThreadId;
      /** An instance id, or a driver or provider name that names one instance. */
      readonly provider: string;
    }) => Effect.Effect<ProviderSignInResult, ProviderSignInError>;
  }
>()("t3/provider/ProviderSignIn") {}

const nameOf = (provider: ServerProvider) =>
  provider.displayName ?? PROVIDER_DISPLAY_NAMES[provider.driver] ?? provider.instanceId;

const normalized = (value: string) => value.toLowerCase().replaceAll(/[^a-z0-9]/g, "");

/** Small models pass "claude" or "Claude Code" as often as an instance id. */
const findProvider = (providers: ReadonlyArray<ServerProvider>, requested: string) => {
  const exact = providers.find((provider) => provider.instanceId === requested.trim());
  if (exact !== undefined) return exact;
  const query = normalized(requested);
  if (query === "") return undefined;
  const matches = providers.filter((provider) =>
    [provider.instanceId, provider.driver, nameOf(provider)].some((value) =>
      normalized(value).startsWith(query),
    ),
  );
  return matches.length === 1 ? matches[0] : undefined;
};

const make = Effect.gen(function* () {
  const registry = yield* ProviderRegistry;
  const settingsService = yield* ServerSettingsService;
  const environment = yield* ServerEnvironment;
  const config = yield* ServerConfig;
  const terminals = yield* TerminalManager;
  const installation = yield* ProviderInstallation;
  // The shell pid each sign-in terminal had when its command was typed, so a call never
  // types it twice into one shell but does into a restarted one.
  const typedShells = new Map<string, number | null>();

  const requireWindow = Effect.fn("ProviderSignIn.requireWindow")(function* (
    threadId: ThreadId,
    fallback: string,
  ) {
    if (yield* (yield* ThreadViewers).isWatched(threadId)) return;
    return yield* new ProviderSignInError({
      reason: "no_window",
      message: `No Up.computer window has this chat open, so the user can't see a sign-in. ${fallback}`,
    });
  });

  const signIn: ProviderSignIn["Service"]["signIn"] = Effect.fn("ProviderSignIn.signIn")(
    function* ({ threadId, provider: requested }) {
      yield* Effect.annotateCurrentSpan({ "orchestration_v2.thread_id": threadId });
      const found = findProvider(yield* registry.getProviders, requested);
      const providers =
        found === undefined
          ? yield* registry.getProviders
          : yield* registry.refreshInstance(found.instanceId);
      const provider = providers.find((candidate) => candidate.instanceId === found?.instanceId);
      if (provider === undefined) {
        const known = providers.map((entry) => `${entry.instanceId} (${nameOf(entry)})`);
        return yield* new ProviderSignInError({
          reason: "unknown_provider",
          message: `No single provider matches "${requested}". Use one of these ids: ${known.join(", ") || "none"}.`,
        });
      }
      const name = nameOf(provider);
      const base = { provider: name, instanceId: provider.instanceId };
      if (!provider.enabled || provider.status === "disabled") {
        return yield* new ProviderSignInError({
          reason: "disabled",
          message: `${name} is turned off. Ask the user to turn it on in Settings, Providers, then call this again.`,
        });
      }
      if (provider.auth.status === "authenticated") {
        return { ...base, status: "signedIn" as const, message: `${name} is signed in.` };
      }
      const settings = yield* settingsService.getSettings.pipe(
        Effect.mapError(
          () =>
            new ProviderSignInError({
              reason: "terminal_failed",
              message: "Could not read this environment's settings. Try again.",
            }),
        ),
      );
      const platform = (yield* environment.getDescriptor).platform.os;
      const command = resolveProviderSignInCommand(provider, settings, platform);
      if (command === null) {
        const setup = provider.setup;
        if (setup === undefined || !(setup.canAuthenticate || setup.canInstall)) {
          return {
            ...base,
            status: "useSettings" as const,
            message: `${name} has no sign-in Up.computer can start. Ask the user to sign in from ${SETTINGS_PATH}.`,
          };
        }
        yield* requireWindow(threadId, `Ask the user to set it up in ${SETTINGS_PATH}.`);
        const installing = !provider.installed && setup.canInstall;
        if (installing) {
          yield* installation.start({ instanceId: provider.instanceId }).pipe(
            Effect.mapError(
              (error) =>
                new ProviderSignInError({
                  reason: "install_failed",
                  message: `Could not install ${name}: ${error.message} Ask the user to try from ${SETTINGS_PATH}.`,
                }),
            ),
          );
        }
        return {
          ...base,
          status: "appSetup" as const,
          appSetupInstanceId: provider.instanceId,
          message: `${installing ? `Up.computer is installing ${name}. ` : ""}This chat now shows ${name}'s setup card, where the user signs in with the app's own sign-in (for Antigravity, a Google link and a code). Ask the user to follow the card, then call this again to check that ${name} is signed in.`,
        };
      }
      if (!provider.installed) {
        return yield* new ProviderSignInError({
          reason: "not_installed",
          message: `${name} is not installed, or Up.computer can't find it. Install its CLI first, then call this again.`,
        });
      }
      yield* requireWindow(
        threadId,
        `Ask the user to run \`${command}\` in a terminal, or to sign in from ${SETTINGS_PATH}.`,
      );

      const terminalId = providerSignInTerminalId(provider.instanceId);
      const terminalFailed = () =>
        new ProviderSignInError({
          reason: "terminal_failed",
          message: `Could not open a terminal. Ask the user to run \`${command}\` in a terminal, or to sign in from ${SETTINGS_PATH}.`,
        });
      const shell = yield* terminals
        .open({ threadId, terminalId, cwd: config.cwd, providerInstanceId: provider.instanceId })
        .pipe(Effect.mapError(terminalFailed));
      const key = `${threadId}\u0000${terminalId}`;
      if (typedShells.get(key) === shell.pid) {
        return {
          ...base,
          command,
          status: "alreadyOpen" as const,
          message: `The sign-in terminal is already open in this chat with \`${command}\`, and ${name} is not signed in yet. Ask the user to press Enter there and finish signing in, then call this again to check.`,
        };
      }
      yield* terminals
        .write({ threadId, terminalId, data: command })
        .pipe(Effect.mapError(terminalFailed));
      typedShells.set(key, shell.pid);
      return {
        ...base,
        command,
        signInTerminalId: terminalId,
        status: "opened" as const,
        message: `Opened a terminal in this chat with \`${command}\` typed in. Ask the user to review it, press Enter, and finish signing in. Then call this again to check that ${name} is signed in.`,
      };
    },
  );

  return ProviderSignIn.of({ signIn });
});

export const layer = Layer.effect(ProviderSignIn, make);
