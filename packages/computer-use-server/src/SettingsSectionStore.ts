// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";

const writeQueues = new Map<string, Promise<void>>();

function settingsRecord(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? { ...(parsed as Record<string, unknown>) }
      : {};
  } catch {
    return {};
  }
}

/** Atomically replaces one section of the server settings file, keeping every other key. */
export function updateSettingsSection(
  settingsPath: string,
  section: "browser" | "computerUse",
  value: unknown,
): Promise<void> {
  const previous = writeQueues.get(settingsPath) ?? Promise.resolve();
  const write = previous
    .catch(() => undefined)
    .then(async () => {
      const raw = await NodeFSP.readFile(settingsPath, "utf8").catch(() => "");
      const settings = settingsRecord(raw);
      settings[section] = value;
      const temporaryPath = `${settingsPath}.computer-use.tmp`;
      await NodeFSP.writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`);
      await NodeFSP.rename(temporaryPath, settingsPath);
    });
  writeQueues.set(settingsPath, write);
  return write.finally(() => {
    if (writeQueues.get(settingsPath) === write) writeQueues.delete(settingsPath);
  });
}
