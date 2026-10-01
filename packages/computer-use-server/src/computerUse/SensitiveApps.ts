// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";

/**
 * Matched as substrings against the `app` argument, which may be a visible
 * name or a bundle identifier, so plurals and IDs such as
 * `com.apple.Passwords` or `com.agilebits.onepassword7` are caught too.
 */
const SENSITIVE_APP_PATTERNS = [
  /pass(?:word|wd)/i,
  /keychain/i,
  /bitwarden/i,
  /dashlane/i,
  /lastpass/i,
  /keepass/i,
  /enpass/i,
  /proton\s*pass/i,
  /wallet/i,
  /payment/i,
  /парол/iu,
  /связка ключей/iu,
] as const;

/**
 * macOS credential apps whose localized names agents may use as targets. Their
 * names in every system language are read from the bundles' own tables.
 */
const SYSTEM_CREDENTIAL_APP_BUNDLES = [
  "/System/Applications/Passwords.app",
  "/System/Applications/Utilities/Keychain Access.app",
  "/System/Library/CoreServices/Applications/Keychain Access.app",
] as const;

/** Used when the bundles cannot be read, e.g. on other platforms or in tests. */
const KNOWN_LOCALIZED_NAMES = [
  // Passwords
  "Пароли",
  "Passwörter",
  "Mots de passe",
  "Contraseñas",
  "Senhas",
  "Wachtwoorden",
  "Salasanat",
  "Parolalar",
  "Hasła",
  "パスワード",
  "密码",
  "密碼",
  "암호",
  // Keychain Access
  "Связка ключей",
  "Schlüsselbundverwaltung",
  "Trousseaux d’accès",
  "Acceso a Llaveros",
  "Accesso Portachiavi",
  "キーチェーンアクセス",
  "钥匙串访问",
  "鑰匙圈存取",
  "키체인 접근",
] as const;

/** Case-, width- and soft-hyphen-insensitive form; a trailing `.app` is ignored. */
function normalizeAppName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[­​-‍⁠﻿]/gu, "")
    .replace(/[’‘]/gu, "'")
    .replace(/\.app$/iu, "")
    .trim()
    .toLowerCase();
}

function bundleNames(bundlePath: string): string[] {
  const names: string[] = [];
  const read = (file: string) => {
    if (!NodeFS.existsSync(file)) return undefined;
    try {
      return JSON.parse(
        NodeChildProcess.execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", file], {
          encoding: "utf8",
          timeout: 5_000,
        }),
      ) as unknown;
    } catch {
      return undefined;
    }
  };
  const collect = (entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return;
    for (const key of ["CFBundleDisplayName", "CFBundleName", "CFBundleIdentifier"]) {
      const value = (entry as Record<string, unknown>)[key];
      if (typeof value === "string" && value.trim()) names.push(value);
    }
  };
  collect(read(`${bundlePath}/Contents/Info.plist`));
  const localized = read(`${bundlePath}/Contents/Resources/InfoPlist.loctable`);
  if (typeof localized === "object" && localized !== null) {
    for (const entry of Object.values(localized)) collect(entry);
  }
  return names;
}

let sensitiveNames: ReadonlySet<string> | undefined;

/** Every known name of the system credential apps, read once per process. */
export function systemCredentialAppNames(): ReadonlySet<string> {
  sensitiveNames ??= new Set(
    [
      ...KNOWN_LOCALIZED_NAMES,
      // Absent bundles (other platforms, older macOS) contribute nothing.
      ...SYSTEM_CREDENTIAL_APP_BUNDLES.flatMap(bundleNames),
    ].map(normalizeAppName),
  );
  return sensitiveNames;
}

/** Whether `app` targets a credential or payment surface. */
export function isSensitiveApp(app: unknown): boolean {
  if (typeof app !== "string") return false;
  const normalized = normalizeAppName(app);
  return (
    systemCredentialAppNames().has(normalized) ||
    SENSITIVE_APP_PATTERNS.some((pattern) => pattern.test(normalized))
  );
}
