// @effect-diagnostics nodeBuiltinImport:off - Offline migration runs before the application runtime and database layers.
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import * as Schema from "effect/Schema";

export interface ProfileMigrationRoot {
  readonly id: "backend" | "electron";
  readonly source: string;
  readonly destination: string;
}
export interface ProfileMigrationPlan {
  readonly directory: string;
  readonly roots: ReadonlyArray<ProfileMigrationRoot>;
}
export interface ProfileMigrationLease {
  /** Must cover every old/new owner, including processes without a runtime PID file. */
  readonly assertHeld: () => Promise<void>;
  readonly release: () => Promise<void>;
}
export interface ProfileMigrationCandidate extends ProfileMigrationRoot {
  readonly originalSource: string;
}
export interface ProfileMigrationAdapter {
  readonly acquireOfflineLease: (plan: ProfileMigrationPlan) => Promise<ProfileMigrationLease>;
  /** Rewrite only audited structured references in candidates, never in sources/backups. */
  readonly prepare: (roots: ReadonlyArray<ProfileMigrationCandidate>) => Promise<void>;
  /** Required native/SQLite/crypto/path validation. A successful byte copy is insufficient. */
  readonly validate: (
    roots: ReadonlyArray<ProfileMigrationCandidate>,
    phase: "candidate" | "published",
  ) => Promise<void>;
  /** Versioned, replayable external transaction. Its journal must precede every external write. */
  readonly external?: {
    readonly id: string;
    readonly commit: () => Promise<void>;
    readonly rollback: () => Promise<void>;
  };
}

export class ProfileMigrationError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(
      `Profile migration stopped (${code}). Original profiles and recovery copies were retained.`,
    );
    this.name = "ProfileMigrationError";
    this.code = code;
  }
}
const fail = (code: string): never => {
  throw new ProfileMigrationError(code);
};
const RootPath = Schema.Struct({
  id: Schema.Literals(["backend", "electron"]),
  source: Schema.String,
  destination: Schema.String,
});
const RootState = Schema.Struct({
  id: Schema.Literals(["backend", "electron"]),
  sourceDigest: Schema.String,
  candidateDigest: Schema.optional(Schema.String),
});
const Journal = Schema.Struct({
  version: Schema.Literals([1, 2]),
  planDigest: Schema.String,
  externalId: Schema.optional(Schema.String),
  paths: Schema.Array(RootPath),
  phase: Schema.Literals([
    "copying",
    "prepared",
    "publishing",
    "complete",
    "rolling-back",
    "rolled-back",
  ]),
  roots: Schema.Array(RootState),
});
type Journal = typeof Journal.Type;
const decodeJournal = Schema.decodeUnknownSync(Schema.fromJsonString(Journal));
const encodeJournal = Schema.encodeSync(Schema.fromJsonString(Journal));
const Owner = Schema.Struct({ pid: Schema.Int, nonce: Schema.String });
const decodeOwner = Schema.decodeUnknownSync(Schema.fromJsonString(Owner));
const encodeOwner = Schema.encodeSync(Schema.fromJsonString(Owner));
const encodePlan = Schema.encodeSync(
  Schema.fromJsonString(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        source: Schema.String,
        destination: Schema.String,
      }),
    ),
  ),
);
const encodeEntry = Schema.encodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      path: Schema.String,
      kind: Schema.String,
      mode: Schema.Int,
      hash: Schema.String,
    }),
  ),
);

export const profileMigrationDirectory = (home: string): string =>
  NodePath.join(home, ".upcomputer-migrations", "profile-v1");

function missing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
async function exists(path: string): Promise<boolean> {
  try {
    await NodeFSP.lstat(path);
    return true;
  } catch (error) {
    if (missing(error)) return false;
    throw error;
  }
}
function overlaps(a: string, b: string): boolean {
  // Conservatively reject case/normalization-only distinctions even on a
  // case-sensitive volume; a plan must remain unambiguous on supported hosts.
  const relative = NodePath.relative(
    a.normalize("NFC").toLowerCase(),
    b.normalize("NFC").toLowerCase(),
  );
  return (
    relative === "" ||
    (!relative.startsWith(`..${NodePath.sep}`) &&
      relative !== ".." &&
      !NodePath.isAbsolute(relative))
  );
}
function canonical(path: string): string {
  if (!NodePath.isAbsolute(path)) return fail("absolute-path-required");
  const resolved = NodePath.resolve(path);
  try {
    if (NodeFS.lstatSync(resolved).isSymbolicLink()) return fail("symlink-root");
    return NodeFS.realpathSync(resolved);
  } catch (error) {
    if (!missing(error)) throw error;
    const parent = NodePath.dirname(resolved);
    if (parent === resolved) return fail("missing-volume");
    return NodePath.join(canonical(parent), NodePath.basename(resolved));
  }
}
function existingAncestor(path: string): NodeFS.Stats {
  try {
    return NodeFS.statSync(path);
  } catch (error) {
    if (!missing(error) || NodePath.dirname(path) === path) throw error;
    return existingAncestor(NodePath.dirname(path));
  }
}
function normalize(plan: ProfileMigrationPlan): ProfileMigrationPlan {
  if (
    plan.roots.length < 1 ||
    plan.roots.length > 2 ||
    new Set(plan.roots.map((root) => root.id)).size !== plan.roots.length
  )
    fail("invalid-roots");
  for (const root of plan.roots) {
    if (!["backend", "electron"].includes(root.id) || !NodeFS.lstatSync(root.source).isDirectory())
      fail("invalid-roots");
  }
  const normalized = {
    directory: canonical(plan.directory),
    roots: plan.roots
      .map((root) => ({
        ...root,
        source: canonical(root.source),
        destination: canonical(root.destination),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
  const paths = [
    normalized.directory,
    ...normalized.roots.flatMap((root) => [root.source, root.destination]),
  ];
  for (let i = 0; i < paths.length; i++)
    for (let j = i + 1; j < paths.length; j++) {
      if (overlaps(paths[i]!, paths[j]!) || overlaps(paths[j]!, paths[i]!))
        fail("overlapping-roots");
    }
  // Also detect existing filesystem aliases (e.g. bind mounts) by identity.
  for (const root of paths) {
    let identity: NodeFS.Stats;
    try {
      identity = NodeFS.statSync(root);
    } catch (error) {
      if (missing(error)) continue;
      throw error;
    }
    for (const other of paths) {
      if (other === root) continue;
      for (let ancestor = other; ; ancestor = NodePath.dirname(ancestor)) {
        try {
          const stat = NodeFS.statSync(ancestor);
          if (stat.dev === identity.dev && stat.ino === identity.ino) fail("overlapping-roots");
        } catch (error) {
          if (!missing(error)) throw error;
        }
        if (NodePath.dirname(ancestor) === ancestor) break;
      }
    }
  }
  const device = existingAncestor(normalized.directory).dev;
  for (const root of normalized.roots) {
    const parent = NodeFS.statSync(NodePath.dirname(root.destination));
    if (!parent.isDirectory()) fail("destination-parent-missing");
    if (parent.dev !== device) fail("cross-device-publication-unsupported");
  }
  return normalized;
}
const planDigest = (plan: ProfileMigrationPlan) =>
  NodeCrypto.createHash("sha256").update(encodePlan(plan.roots)).digest("hex");
const journalPath = (plan: ProfileMigrationPlan) => NodePath.join(plan.directory, "journal.json");
const backupPath = (plan: ProfileMigrationPlan, id: string) =>
  NodePath.join(plan.directory, "backup", id);
const candidatePath = (plan: ProfileMigrationPlan, id: string) =>
  NodePath.join(plan.directory, "candidate", id);

async function syncDirectory(path: string): Promise<void> {
  // Windows does not expose directory fsync through Node. Native crash/power-loss
  // verification is a release gate; file flushes still apply on every platform.
  // oxlint-disable-next-line upcomputer/no-global-process-runtime -- Native bootstrap boundary: no Effect runtime exists yet; fsync must follow the actual filesystem platform.
  if (process.platform === "win32") return;
  const handle = await NodeFSP.open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function writeJournal(plan: ProfileMigrationPlan, journal: Journal): Promise<void> {
  const temp = NodePath.join(plan.directory, `journal-${NodeCrypto.randomUUID()}.tmp`);
  const file = await NodeFSP.open(temp, "wx", 0o600);
  try {
    await file.writeFile(encodeJournal(journal));
    await file.sync();
  } finally {
    await file.close();
  }
  await NodeFSP.rename(temp, journalPath(plan));
  await syncDirectory(plan.directory);
}
function readJournal(path: string): Journal | null {
  try {
    const stat = NodeFS.lstatSync(path);
    if (!stat.isFile() || stat.size > 16384) return fail("invalid-journal");
    const journal = decodeJournal(NodeFS.readFileSync(path, "utf8"));
    if (
      (journal.version === 1 && journal.externalId !== undefined) ||
      (journal.version === 2 && !journal.externalId) ||
      journal.paths.length < 1 ||
      journal.paths.length > 2 ||
      journal.roots.length !== journal.paths.length ||
      new Set(journal.paths.map((root) => root.id)).size !== journal.paths.length ||
      journal.roots.some(
        (root, i) =>
          root.id !== journal.paths[i]!.id ||
          !/^[a-f0-9]{64}$/.test(root.sourceDigest) ||
          (["prepared", "publishing", "complete"].includes(journal.phase) &&
            !/^[a-f0-9]{64}$/.test(root.candidateDigest ?? "")),
      )
    )
      fail("invalid-journal");
    if (
      journal.planDigest !==
      NodeCrypto.createHash("sha256").update(encodePlan(journal.paths)).digest("hex")
    )
      fail("invalid-journal-plan");
    return journal;
  } catch (error) {
    if (missing(error)) return null;
    if (error instanceof ProfileMigrationError) throw error;
    return fail("unreadable-journal");
  }
}

/** Called before Clerk, Electron userData, or backend directories/SQLite are opened. */
export function assertProfileMigrationStartupAllowed(directory: string): void {
  if (NodeFS.existsSync(NodePath.join(directory, "lock"))) fail("maintenance-in-progress");
  const journal = readJournal(NodePath.join(directory, "journal.json"));
  if (journal?.phase === "complete" || journal?.phase === "rolled-back") {
    for (const root of journal.paths) {
      const path = journal.phase === "complete" ? root.destination : root.source;
      try {
        if (!NodeFS.lstatSync(path).isDirectory()) fail("committed-profile-missing");
      } catch {
        fail("committed-profile-missing");
      }
    }
  }
  if (journal && journal.phase !== "complete" && journal.phase !== "rolled-back")
    fail("maintenance-in-progress");
  // A job with no durable journal is not evidence of a fresh installation.
  if (!journal && NodeFS.existsSync(directory)) {
    if (NodeFS.readdirSync(directory).length > 0) fail("incomplete-maintenance-journal");
  }
}

async function treeDigest(root: string): Promise<string> {
  const digest = NodeCrypto.createHash("sha256");
  async function visit(path: string, relative: string): Promise<void> {
    const before = await NodeFSP.lstat(path);
    if (before.isSymbolicLink() || (!before.isFile() && !before.isDirectory()))
      fail("unsupported-profile-entry");
    if (before.isFile() && before.nlink !== 1) fail("hardlinked-profile-entry");
    if (before.isDirectory()) {
      // The root is intentionally private (0700) in backups/candidates, even if
      // the original directory was more permissive.
      digest.update(
        encodeEntry({
          path: relative,
          kind: "directory",
          mode: relative ? before.mode & 0o777 : 0o700,
          hash: "",
        }),
      );
      for (const name of (await NodeFSP.readdir(path)).sort())
        await visit(NodePath.join(path, name), NodePath.join(relative, name));
    } else {
      const hash = NodeCrypto.createHash("sha256");
      for await (const chunk of NodeFS.createReadStream(path)) hash.update(chunk);
      digest.update(
        encodeEntry({
          path: relative,
          kind: "file",
          mode: before.mode & 0o777,
          hash: hash.digest("hex"),
        }),
      );
    }
    const after = await NodeFSP.lstat(path);
    if (
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      fail("source-changed");
  }
  await visit(root, "");
  return digest.digest("hex");
}
async function copyTree(source: string, destination: string): Promise<void> {
  await NodeFSP.mkdir(destination, { mode: 0o700 });
  for (const name of (await NodeFSP.readdir(source)).sort()) {
    const from = NodePath.join(source, name),
      to = NodePath.join(destination, name);
    const stat = await NodeFSP.lstat(from);
    if (stat.isDirectory()) {
      await copyTree(from, to);
      await NodeFSP.chmod(to, stat.mode & 0o777);
      await syncDirectory(to);
    } else if (stat.isFile() && stat.nlink === 1) {
      await NodeFSP.copyFile(from, to, NodeFS.constants.COPYFILE_EXCL);
      await NodeFSP.chmod(to, 0o600);
      const file = await NodeFSP.open(to, "r+");
      try {
        await file.chmod(stat.mode & 0o777);
        await file.sync();
      } finally {
        await file.close();
      }
    } else fail("unsupported-profile-entry");
  }
  await syncDirectory(destination);
  await syncDirectory(NodePath.dirname(destination));
}
async function preserveAttempt(path: string): Promise<void> {
  if (await exists(path))
    await NodeFSP.rename(path, `${path}.interrupted-${NodeCrypto.randomUUID()}`);
}
function alive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ESRCH"
    );
  }
}

/** A job mutex, NOT a substitute for the native old/new profile ownership lease. */
async function lock(plan: ProfileMigrationPlan): Promise<() => Promise<void>> {
  const path = NodePath.join(plan.directory, "lock");
  try {
    await NodeFSP.mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (
      !(typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST")
    )
      throw error;
    let owner: typeof Owner.Type;
    try {
      owner = decodeOwner(await NodeFSP.readFile(NodePath.join(path, "owner.json"), "utf8"));
    } catch {
      return fail("ambiguous-maintenance-lock");
    }
    if (alive(owner.pid)) return fail("maintenance-busy");
    // Exactly one recovery contender can retire a dead owner's directory.
    await NodeFSP.mkdir(NodePath.join(path, "recovery"), { mode: 0o700 }).catch(() =>
      fail("maintenance-busy"),
    );
    const recheck = decodeOwner(await NodeFSP.readFile(NodePath.join(path, "owner.json"), "utf8"));
    if (recheck.nonce !== owner.nonce || alive(recheck.pid)) return fail("maintenance-busy");
    await NodeFSP.rename(path, `${path}.abandoned-${NodeCrypto.randomUUID()}`);
    await NodeFSP.mkdir(path, { mode: 0o700 });
  }
  const owner = { pid: process.pid, nonce: NodeCrypto.randomUUID() };
  const file = await NodeFSP.open(NodePath.join(path, "owner.json"), "wx", 0o600);
  try {
    await file.writeFile(encodeOwner(owner));
    await file.sync();
  } finally {
    await file.close();
  }
  await syncDirectory(path);
  await syncDirectory(plan.directory);
  return async () => {
    const current = decodeOwner(await NodeFSP.readFile(NodePath.join(path, "owner.json"), "utf8"));
    if (current.nonce !== owner.nonce) return fail("maintenance-lock-changed");
    await NodeFSP.unlink(NodePath.join(path, "owner.json"));
    await NodeFSP.rmdir(path);
    await syncDirectory(plan.directory);
  };
}

export interface ProfileMigrationOptions {
  readonly adapter: ProfileMigrationAdapter;
  /** Maintenance progress hook. Contains only phase/IDs, never profile contents. */
  readonly checkpoint?: (phase: Journal["phase"], rootId?: string) => Promise<void>;
}

/** Offline only. No default native lease or validation bypass is provided. */
async function migrateProfileImpl(
  planInput: ProfileMigrationPlan,
  options: ProfileMigrationOptions,
): Promise<"complete"> {
  const external = options.adapter.external;
  if (
    external &&
    (typeof external.id !== "string" ||
      external.id.trim().length === 0 ||
      external.id.length > 128 ||
      typeof external.commit !== "function" ||
      typeof external.rollback !== "function")
  )
    fail("invalid-external-participant");
  const plan = normalize(planInput);
  await makeDurableJobDirectory(plan.directory);
  await assertControlLayout(plan);
  const unlock = await lock(plan);
  let lease: ProfileMigrationLease | undefined;
  try {
    await assertNoRecordedProfileOwners(plan.roots);
    lease = await options.adapter.acquireOfflineLease(plan);
    await lease.assertHeld();
    let journal = readJournal(journalPath(plan));
    const identity = planDigest(plan);
    if (
      journal &&
      (journal.planDigest !== identity ||
        journal.externalId !== options.adapter.external?.id ||
        journal.roots.length !== plan.roots.length ||
        journal.roots.some((root, i) => root.id !== plan.roots[i]!.id))
    )
      fail("plan-mismatch");
    if (journal?.phase === "complete") return "complete";
    if (journal?.phase === "rolling-back") return fail("rollback-in-progress");
    if (journal?.phase === "rolled-back") return fail("migration-already-rolled-back");
    if (!journal) {
      const unexpected = (await NodeFSP.readdir(plan.directory)).filter(
        (name) => name !== "lock" && !name.startsWith("lock.abandoned-"),
      );
      if (unexpected.length) fail("incomplete-maintenance-journal");
      for (const root of plan.roots)
        if (await exists(root.destination)) fail("destination-conflict");
      const roots = [];
      for (const root of plan.roots)
        roots.push({ id: root.id, sourceDigest: await treeDigest(root.source) });
      journal = {
        version: options.adapter.external ? 2 : 1,
        planDigest: identity,
        paths: plan.roots,
        phase: "copying",
        roots,
        ...(options.adapter.external ? { externalId: options.adapter.external.id } : {}),
      };
      await writeJournal(plan, journal);
    }
    for (const root of plan.roots) {
      if (
        (await treeDigest(root.source)) !==
        journal.roots.find((state) => state.id === root.id)!.sourceDigest
      )
        fail("source-changed");
    }
    if (journal.phase === "copying") {
      await options.checkpoint?.("copying");
      for (const directory of ["backup", "candidate"])
        await NodeFSP.mkdir(NodePath.join(plan.directory, directory), {
          recursive: true,
          mode: 0o700,
        });
      for (const root of plan.roots) {
        const expected = journal.roots.find((state) => state.id === root.id)!.sourceDigest;
        const backup = backupPath(plan, root.id);
        if (!(await exists(backup)) || (await treeDigest(backup)) !== expected) {
          await preserveAttempt(backup);
          await copyTree(root.source, backup);
        }
        if ((await treeDigest(backup)) !== expected || (await treeDigest(root.source)) !== expected)
          fail("backup-verification-failed");
        const candidate = candidatePath(plan, root.id);
        await preserveAttempt(candidate);
        await copyTree(backup, candidate);
      }
      const candidates = plan.roots.map((root) => ({
        ...root,
        originalSource: root.source,
        source: candidatePath(plan, root.id),
      }));
      await options.adapter.prepare(candidates);
      await options.adapter.validate(candidates, "candidate");
      const roots = [];
      for (const root of plan.roots)
        roots.push({
          ...journal.roots.find((state) => state.id === root.id)!,
          candidateDigest: await treeDigest(candidatePath(plan, root.id)),
        });
      journal = { ...journal, phase: "prepared", roots };
      await writeJournal(plan, journal);
      await options.checkpoint?.("prepared");
    }
    // Re-validate after restart, including mixed published/staged roots. The journal,
    // not directory existence, is the commit point used by startup guards.
    const candidates = [];
    for (const root of plan.roots) {
      const published = await exists(root.destination);
      const staged = await exists(candidatePath(plan, root.id));
      if (published && (staged || journal.phase !== "publishing")) fail("destination-conflict");
      const source = published ? root.destination : candidatePath(plan, root.id);
      if (
        (await treeDigest(source)) !==
        journal.roots.find((state) => state.id === root.id)!.candidateDigest
      )
        fail("candidate-changed");
      candidates.push({ ...root, originalSource: root.source, source });
    }
    await options.adapter.validate(candidates, "candidate");
    for (const candidate of candidates) {
      if (
        (await treeDigest(candidate.source)) !==
        journal.roots.find((root) => root.id === candidate.id)!.candidateDigest
      )
        fail("validation-mutated-candidate");
    }
    await lease.assertHeld();
    for (const root of plan.roots) {
      if (
        (await treeDigest(root.source)) !==
        journal.roots.find((state) => state.id === root.id)!.sourceDigest
      )
        fail("source-changed");
      if (
        (await treeDigest(backupPath(plan, root.id))) !==
        journal.roots.find((state) => state.id === root.id)!.sourceDigest
      )
        fail("backup-changed");
    }
    journal = { ...journal, phase: "publishing" };
    await writeJournal(plan, journal);
    for (const root of plan.roots) {
      await lease.assertHeld();
      const staged = candidatePath(plan, root.id);
      if (await exists(staged)) {
        if (await exists(root.destination)) fail("destination-conflict");
        // The required native lease must exclude every destination writer. No
        // portable Node API provides RENAME_NOREPLACE for directories.
        await NodeFSP.rename(staged, root.destination);
        await syncDirectory(NodePath.dirname(root.destination));
        await syncDirectory(NodePath.dirname(staged));
      }
      await options.checkpoint?.("publishing", root.id);
    }
    await lease.assertHeld();
    await options.adapter.external?.commit();
    await options.adapter.validate(
      plan.roots.map((root) => ({
        ...root,
        originalSource: root.source,
        source: root.destination,
      })),
      "published",
    );
    await lease.assertHeld();
    for (const root of plan.roots) {
      if (
        (await treeDigest(root.destination)) !==
        journal.roots.find((state) => state.id === root.id)!.candidateDigest
      )
        fail("validation-mutated-candidate");
    }
    await writeJournal(plan, { ...journal, phase: "complete" });
    await options.checkpoint?.("complete");
    return "complete";
  } catch (error) {
    if (error instanceof ProfileMigrationError) throw error;
    return fail("io-or-validation-failed");
  } finally {
    try {
      await lease?.release();
    } finally {
      await unlock();
    }
  }
}

/** Abort before activation. Never overwrites/deletes a source or a published tree;
 * verified published candidates are quarantined, so rollback itself is resumable.
 * After completion use a separate, explicitly reviewed restore procedure instead.
 */
async function rollbackProfileMigrationImpl(
  planInput: ProfileMigrationPlan,
  options: ProfileMigrationOptions,
): Promise<"rolled-back"> {
  const plan = normalize(planInput);
  if (!readJournal(journalPath(plan))) return fail("missing-journal");
  await assertControlLayout(plan);
  const unlock = await lock(plan);
  let lease: ProfileMigrationLease | undefined;
  try {
    await assertNoRecordedProfileOwners(plan.roots);
    lease = await options.adapter.acquireOfflineLease(plan);
    await lease.assertHeld();
    let journal = readJournal(journalPath(plan))!;
    if (
      journal.planDigest !== planDigest(plan) ||
      journal.externalId !== options.adapter.external?.id
    )
      fail("plan-mismatch");
    if (journal.phase === "complete") fail("activated-profile-requires-explicit-restore");
    if (journal.phase === "rolled-back") return "rolled-back";
    for (const root of plan.roots) {
      const state = journal.roots.find((state) => state.id === root.id);
      if (!state) return fail("plan-mismatch");
      if ((await treeDigest(root.source)) !== state.sourceDigest) fail("source-changed");
      if (await exists(root.destination)) {
        if (
          !["publishing", "rolling-back"].includes(journal.phase) ||
          (await exists(candidatePath(plan, root.id))) ||
          (await treeDigest(root.destination)) !== state.candidateDigest
        )
          fail("destination-conflict");
      }
    }
    journal = { ...journal, phase: "rolling-back" };
    await writeJournal(plan, journal);
    await lease.assertHeld();
    await options.adapter.external?.rollback();
    const quarantine = NodePath.join(plan.directory, "rolled-back");
    await NodeFSP.mkdir(quarantine, { recursive: true, mode: 0o700 });
    for (const root of plan.roots) {
      await lease.assertHeld();
      if (await exists(root.destination)) {
        const target = NodePath.join(quarantine, root.id);
        if (await exists(target)) fail("rollback-conflict");
        await NodeFSP.rename(root.destination, target);
        await syncDirectory(NodePath.dirname(root.destination));
        await syncDirectory(quarantine);
      }
      await options.checkpoint?.("rolling-back", root.id);
    }
    await writeJournal(plan, { ...journal, phase: "rolled-back" });
    return "rolled-back";
  } catch (error) {
    if (error instanceof ProfileMigrationError) throw error;
    return fail("io-or-validation-failed");
  } finally {
    try {
      await lease?.release();
    } finally {
      await unlock();
    }
  }
}

const RuntimeOwner = Schema.Struct({ pid: Schema.Int });
const decodeRuntimeOwner = Schema.decodeUnknownSync(Schema.fromJsonString(RuntimeOwner));
/** Negative preflight only: absence of markers is NOT proof that a profile is idle.
 * The native maintenance lease is mandatory even when this check succeeds.
 */
export async function assertNoRecordedProfileOwners(
  roots: ReadonlyArray<ProfileMigrationRoot>,
): Promise<void> {
  for (const root of roots)
    for (const directory of [root.source, root.destination]) {
      for (const marker of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
        if (await exists(NodePath.join(directory, marker))) fail("native-owner-marker-present");
      }
      for (const state of ["userdata", "dev"]) {
        const stateDirectory = NodePath.join(directory, state);
        if ((await exists(stateDirectory)) && !(await NodeFSP.lstat(stateDirectory)).isDirectory())
          fail("unsupported-profile-entry");
        const path = NodePath.join(stateDirectory, "server-runtime.json");
        if (!(await exists(path))) continue;
        try {
          const stat = await NodeFSP.lstat(path);
          if (!stat.isFile() || stat.size > 16384) return fail("invalid-owner-record");
          const owner = decodeRuntimeOwner(await NodeFSP.readFile(path, "utf8"));
          if (alive(owner.pid)) return fail("recorded-owner-active");
        } catch (error) {
          if (error instanceof ProfileMigrationError) throw error;
          return fail("invalid-owner-record");
        }
      }
    }
}

/** A completed journal redirects old explicit root overrides too; never rewrite
 * arbitrary descendant paths, prompts, workspace roots, or credential payloads.
 */
export function resolveMigratedProfileRoot(directory: string, requested: string): string {
  assertProfileMigrationStartupAllowed(directory);
  const journal = readJournal(NodePath.join(directory, "journal.json"));
  if (journal?.phase !== "complete") return requested;
  const source = canonical(requested);
  return journal.paths.find((root) => root.source === source)?.destination ?? requested;
}

async function assertControlLayout(plan: ProfileMigrationPlan): Promise<void> {
  for (const path of [
    plan.directory,
    ...["lock", "backup", "candidate", "rolled-back"].map((name) =>
      NodePath.join(plan.directory, name),
    ),
  ]) {
    if ((await exists(path)) && !(await NodeFSP.lstat(path)).isDirectory())
      fail("invalid-maintenance-directory");
  }
}

async function makeDurableJobDirectory(directory: string): Promise<void> {
  const firstCreated = await NodeFSP.mkdir(directory, { recursive: true, mode: 0o700 });
  if (!firstCreated) return;
  const boundary = NodePath.dirname(firstCreated);
  for (let current = directory; ; current = NodePath.dirname(current)) {
    await syncDirectory(current);
    if (current === boundary) break;
  }
}

async function protectOperation<A>(operation: () => Promise<A>): Promise<A> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ProfileMigrationError) throw error;
    return fail("io-or-validation-failed");
  }
}

export function migrateProfile(
  plan: ProfileMigrationPlan,
  options: ProfileMigrationOptions,
): Promise<"complete"> {
  return protectOperation(() => migrateProfileImpl(plan, options));
}
export function rollbackProfileMigration(
  plan: ProfileMigrationPlan,
  options: ProfileMigrationOptions,
): Promise<"rolled-back"> {
  return protectOperation(() => rollbackProfileMigrationImpl(plan, options));
}
