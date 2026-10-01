import * as NodeAssert from "node:assert/strict";
import { ComputerUseSettings } from "@upcomputer/computer-use-contracts";
import * as Schema from "effect/Schema";
import { test } from "vite-plus/test";

import { evaluateComputerUsePolicy } from "./ComputerUsePolicy.ts";

const settings = Schema.decodeUnknownSync(ComputerUseSettings)({});

const decide = (toolName: string, app: string) =>
  evaluateComputerUsePolicy({ toolName, args: { app, elementIndex: 1 }, settings });

test("credential and payment apps are blocked by name, localized name or bundle identifier", () => {
  for (const app of [
    "Passwords",
    "com.apple.Passwords",
    "1Password",
    "1Password 7",
    "com.agilebits.onepassword7",
    "com.1password.1password",
    "Keychain Access",
    "com.apple.keychainaccess",
    "Bitwarden",
    "com.bitwarden.desktop",
    "KeePassXC",
    "Proton Pass",
    "Wallet",
    "Пароли",
    "Связка ключей",
  ]) {
    for (const toolName of ["computer_get_app_state", "computer_click"]) {
      const decision = decide(toolName, app);
      NodeAssert.equal(decision.allowed, false, `${toolName} on ${app}`);
      NodeAssert.match(decision.reason ?? "", /credential or payment surface/u);
    }
  }
});

test("ordinary apps stay usable", () => {
  for (const app of ["Notes", "com.apple.Safari", "Finder"]) {
    NodeAssert.equal(decide("computer_click", app).allowed, true, app);
  }
});
