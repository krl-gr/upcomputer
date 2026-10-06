// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
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

const SECTIONS = ["browser", "computerUse"] as const satisfies ReadonlyArray<SettingsSection>;

/**
 * Moves V1's sections from `settings.json` into the own file before core's
 * next settings save drops them, so restrictive settings (disabled, observe
 * only, action approval, app allowlist) survive it. `settings.json` keeps its
 * copy until that save; it is no longer read once the own file exists.
 *
 * On a normal start an existing own file wins. Right after the V1 cutover,
 * V1's sections replace one an earlier v2 start left behind (a home restored
 * to V1 and moved again). Returns the sections it moved.
 */
export function moveLegacySettingsSections(
  settingsPath: string,
  options: { readonly replace: boolean },
): ReadonlyArray<SettingsSection> {
  const filePath = computerUseSettingsPath(settingsPath);
  if (!options.replace && NodeFS.existsSync(filePath)) return [];
  let legacy: string;
  try {
    legacy = NodeFS.readFileSync(settingsPath, "utf8");
  } catch {
    return [];
  }
  const sections = sectionsOf(legacy) ?? {};
  const moved = SECTIONS.filter((section) => sections[section] !== undefined);
  if (moved.length === 0) return [];
  const temporaryPath = `${filePath}.move-${process.pid}`;
  NodeFS.writeFileSync(temporaryPath, `${JSON.stringify(sections, null, 2)}\n`);
  try {
    if (options.replace) {
      NodeFS.renameSync(temporaryPath, filePath);
    } else {
      // Creates the file only if it is still missing.
      NodeFS.linkSync(temporaryPath, filePath);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return [];
  } finally {
    NodeFS.rmSync(temporaryPath, { force: true });
  }
  return moved;
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
