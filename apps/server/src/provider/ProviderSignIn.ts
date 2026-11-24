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
    ]),
    message: Schema.String,
  },
) {}

export class ProviderSignIn extends Context.Service<
  ProviderSignIn,
  {
    /**
     * Refreshes the provider's status first: a signed-in provider opens nothing, and a call
     * after the user finished reports that. The command is typed again only once the earlier
     * one has run and ended in that shell.
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
  // Each sign-in terminal's shell when its command was typed, and whether a subprocess has
  // run there since. Subprocess polling is about a second apart, so a command that ends
  // faster can go unseen; the user then closes the card and the agent calls again.
  const typedShells = new Map<
    string,
    { readonly pid: number | null; ran: boolean; running: boolean }
  >();
  const keyOf = (threadId: string, terminalId: string) => `${threadId}\u0000${terminalId}`;
  yield* Effect.acquireRelease(
    terminals.subscribe((event) =>
      Effect.sync(() => {
        if (event.type !== "activity") return;
        // A restarted shell gets a new pid, so its entry no longer matches and is typed again.
        const typed = typedShells.get(keyOf(event.threadId, event.terminalId));
        if (typed === undefined) return;
        typed.running = event.hasRunningSubprocess;
        if (event.hasRunningSubprocess) typed.ran = true;
      }),
    ),
    (unsubscribe) => Effect.sync(unsubscribe),
  );

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
      const setup = provider.setup;
      const appSetup =
        command === null && setup !== undefined && (setup.canAuthenticate || setup.canInstall);
      const turnedOff = !provider.enabled || provider.status === "disabled";
      // The app's own setup card turns a provider on itself.
      if (turnedOff && !appSetup) {
        return yield* new ProviderSignInError({
          reason: "disabled",
          message: `${name} is turned off. Ask the user to turn it on in Settings, Providers, then call this again.`,
        });
      }
      if (provider.auth.status === "authenticated" && !turnedOff) {
        return { ...base, status: "signedIn" as const, message: `${name} is signed in.` };
      }
      if (command === null) {
        if (!appSetup) {
          return {
            ...base,
            status: "useSettings" as const,
            message: `${name} has no sign-in Up.computer can start. Ask the user to sign in from ${SETTINGS_PATH}.`,
          };
        }
        yield* requireWindow(threadId, `Ask the user to set it up in ${SETTINGS_PATH}.`);
        // Installing is the user's call: the card's own Install button starts it.
        const install = turnedOff
          ? `${name} is turned off: the user turns it on with the card's Enable button. `
          : !provider.installed && setup?.canInstall
            ? `${name} is not installed yet: the user starts the install with the card's Install button. `
            : "";
        return {
          ...base,
          status: "appSetup" as const,
          appSetupInstanceId: provider.instanceId,
          message: `This chat now shows ${name}'s setup card. ${install}The user signs in there with the app's own sign-in (for Antigravity, a Google link and a code). Ask the user to follow the card, then call this again to check that ${name} is signed in.`,
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
      const key = keyOf(threadId, terminalId);
      const typed = typedShells.get(key);
      if (typed?.pid === shell.pid && typed.running) {
        return {
          ...base,
          command,
          status: "alreadyOpen" as const,
          message: `\`${command}\` is running in the sign-in terminal in this chat, and ${name} is not signed in yet. Ask the user to finish signing in in the browser, then call this again to check.`,
        };
      }
      if (typed?.pid === shell.pid && !typed.ran) {
        return {
          ...base,
          command,
          status: "alreadyOpen" as const,
          message: `The sign-in terminal is already open in this chat with \`${command}\` typed in, and ${name} is not signed in yet. Ask the user to press Enter there and finish signing in, then call this again to check. If its line is empty, ask the user to close the terminal, then call this again.`,
        };
      }
      // A login shell's startup can mark `ran` before Enter, so a re-type first clears the
      // line (Ctrl+U) on POSIX shells; PowerShell has no such binding by default.
      const clearLine = typed?.pid === shell.pid && platform !== "windows" ? "\u0015" : "";
      // Set before writing, so the shell's activity from here on lands on this entry.
      typedShells.set(key, { pid: shell.pid, ran: false, running: false });
      yield* terminals
        .write({ threadId, terminalId, data: `${clearLine}${command}` })
        .pipe(Effect.mapError(terminalFailed));
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
