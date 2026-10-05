// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

export type SettingsSection = "browser" | "computerUse";

export interface SettingsSections {
  readonly browser?: unknown;
  readonly computerUse?: unknown;
}

const writeQueues = new Map<string, Promise<void>>();

/**
 * Browser and computer-use settings live in their own file next to
 * `settings.json`: core rewrites `settings.json` from its own schema and drops
 * keys it does not know.
 */
export function computerUseSettingsPath(settingsPath: string): string {
  return NodePath.join(NodePath.dirname(settingsPath), "computer-use.json");
}

function sectionsOf(raw: string): SettingsSections | undefined {
  if (!raw.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const { browser, computerUse } = parsed as Record<string, unknown>;
    return {
      ...(browser === undefined ? {} : { browser }),
      ...(computerUse === undefined ? {} : { computerUse }),
    };
  } catch {
    return undefined;
  }
}

/**
 * Reads both sections. Until the own file exists, V1's sections in
 * `settings.json` are used, so an upgraded install keeps its settings.
 */
export async function readSettingsSections(settingsPath: string): Promise<SettingsSections> {
  const own = await NodeFSP.readFile(computerUseSettingsPath(settingsPath), "utf8").catch(
    () => undefined,
  );
  if (own !== undefined) return sectionsOf(own) ?? {};
  const legacy = await NodeFSP.readFile(settingsPath, "utf8").catch(() => "");
  return sectionsOf(legacy) ?? {};
}

/** Atomically replaces one section, keeping the other. */
export function updateSettingsSection(
  settingsPath: string,
  section: SettingsSection,
  value: unknown,
): Promise<void> {
  const filePath = computerUseSettingsPath(settingsPath);
  const previous = writeQueues.get(filePath) ?? Promise.resolve();
  const write = previous
    .catch(() => undefined)
    .then(async () => {
      const sections = { ...(await readSettingsSections(settingsPath)), [section]: value };
      const temporaryPath = `${filePath}.tmp`;
      await NodeFSP.writeFile(temporaryPath, `${JSON.stringify(sections, null, 2)}\n`);
      await NodeFSP.rename(temporaryPath, filePath);
    });
  writeQueues.set(filePath, write);
  return write.finally(() => {
    if (writeQueues.get(filePath) === write) writeQueues.delete(filePath);
  });
}
