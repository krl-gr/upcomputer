// @effect-diagnostics nodeBuiltinImport:off - Offline maintenance boundary; never called during ordinary Git operations.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import * as Schema from "effect/Schema";
import { ProfileMigrationError } from "./profileMigration.ts";

const Entry = Schema.Struct({
  relative: Schema.String,
  gitDirectory: Schema.String,
  previous: Schema.String,
  next: Schema.String,
});
const Plan = Schema.Struct({
  version: Schema.Literal(1),
  originalRoot: Schema.String,
  destinationRoot: Schema.String,
  entries: Schema.Array(Entry),
});
type Plan = typeof Plan.Type;
const decode = Schema.decodeUnknownSync(Schema.fromJsonString(Plan));
const encode = Schema.encodeSync(Schema.fromJsonString(Plan));
const fail = (code: string): never => {
  throw new ProfileMigrationError(`git-${code}`);
};
const inside = (root: string, path: string) => {
  const relative = NodePath.relative(root, path);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${NodePath.sep}`) &&
      !NodePath.isAbsolute(relative))
  );
};
const insideFolded = (root: string, path: string) =>
  inside(root.normalize("NFC").toLowerCase(), path.normalize("NFC").toLowerCase());
async function aliasesRoot(root: string, path: string): Promise<boolean> {
  if (!(await present(root))) return false;
  const identity = await NodeFSP.stat(root);
  for (let current = path; ; current = NodePath.dirname(current)) {
    const stat = await NodeFSP.stat(current);
    if (stat.dev === identity.dev && stat.ino === identity.ino) return true;
    if (NodePath.dirname(current) === current) return false;
  }
}
async function present(path: string): Promise<boolean> {
  try {
    await NodeFSP.lstat(path);
    return true;
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}
async function text(path: string): Promise<string> {
  const stat = await NodeFSP.lstat(path);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > 1024 * 1024) fail("unsupported-record");
  return new TextDecoder("utf-8", { fatal: true }).decode(await NodeFSP.readFile(path));
}
function line(value: string): string {
  const result = value.replace(/\r?\n$/, "");
  if (!result || /[\r\n]/.test(result) || result.includes("\0")) return fail("invalid-record");
  return result;
}
async function gitDirectory(gitFile: string): Promise<string> {
  const record = line(await text(gitFile));
  if (!record.startsWith("gitdir: ")) return fail("unsupported-git-file");
  const target = record.slice(8);
  // Relative pointers need their own relocation policy; never silently copy one.
  if (!NodePath.isAbsolute(target)) return fail("relative-git-pointer");
  return NodeFSP.realpath(target);
}
async function syncDirectory(path: string) {
  // oxlint-disable-next-line upcomputer/no-global-process-runtime -- Offline native filesystem boundary, before the application Effect runtime.
  if (process.platform === "win32") return;
  const handle = await NodeFSP.open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function replace(path: string, value: string, expected: string) {
  const stat = await NodeFSP.lstat(path);
  if (!stat.isFile() || stat.nlink !== 1) fail("unsupported-record");
  const temporary = `${path}.upcomputer-${NodeCrypto.randomUUID()}`;
  const handle = await NodeFSP.open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(value);
    await handle.chmod(stat.mode & 0o777);
    await handle.sync();
  } finally {
    await handle.close();
  }
  if ((await text(path)) !== expected) fail("backlink-conflict");
  await NodeFSP.rename(temporary, path);
  await syncDirectory(NodePath.dirname(path));
}

/** Standard linked worktrees only. The native lease must cover the external
 * repository metadata too. This participant never executes hooks or Git commands.
 */
export function createGitWorktreeMigration(input: {
  readonly originalRoot: string;
  readonly destinationRoot: string;
  /** Existing, private coordinator directory. */
  readonly directory: string;
  readonly assertHeld: () => Promise<void>;
}) {
  const file = NodePath.join(input.directory, "git-worktrees.json");
  const original = NodePath.resolve(input.originalRoot),
    destination = NodePath.resolve(input.destinationRoot);
  async function protect<A>(run: () => Promise<A>): Promise<A> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof ProfileMigrationError) throw error;
      return fail("io-or-validation-failed");
    }
  }
  async function check(plan: Plan): Promise<Plan> {
    if (plan.originalRoot !== original || plan.destinationRoot !== destination)
      fail("plan-mismatch");
    const seen = new Set<string>();
    for (const entry of plan.entries) {
      if (
        !inside(NodePath.join(original, "worktrees"), NodePath.resolve(original, entry.relative)) ||
        NodePath.isAbsolute(entry.relative) ||
        entry.relative.split(NodePath.sep).includes("..")
      )
        fail("invalid-relative-path");
      if (
        entry.next !== `${NodePath.join(destination, entry.relative, ".git")}\n` ||
        insideFolded(original, entry.gitDirectory) ||
        insideFolded(destination, entry.gitDirectory) ||
        insideFolded(input.directory, entry.gitDirectory) ||
        (await aliasesRoot(original, entry.gitDirectory)) ||
        (await aliasesRoot(destination, entry.gitDirectory))
      )
        fail("invalid-plan");
      if (seen.has(entry.gitDirectory)) fail("duplicate-worktree");
      seen.add(entry.gitDirectory);
      if (
        (await gitDirectory(NodePath.join(original, entry.relative, ".git"))) !== entry.gitDirectory
      )
        fail("git-pointer-changed");
      if (
        (await NodeFSP.realpath(line(entry.previous))) !==
        (await NodeFSP.realpath(NodePath.join(original, entry.relative, ".git")))
      )
        fail("invalid-backup");
      if (line(await text(NodePath.join(entry.gitDirectory, "commondir"))) !== "../..")
        fail("unsupported-common-directory");
      if (NodePath.basename(NodePath.dirname(entry.gitDirectory)) !== "worktrees")
        fail("unsupported-metadata-directory");
    }
    return plan;
  }
  const load = async () => check(decode(await text(file)));
  const prepare = () =>
    protect(async () => {
      await input.assertHeld();
      if (
        insideFolded(original, destination) ||
        insideFolded(destination, original) ||
        insideFolded(original, input.directory) ||
        insideFolded(destination, input.directory)
      )
        fail("overlapping-paths");
      if (
        (await NodeFSP.realpath(original)) !== original ||
        (await NodeFSP.realpath(input.directory)) !== NodePath.resolve(input.directory)
      )
        fail("noncanonical-path");
      if (await present(file)) {
        const plan = await load();
        for (const entry of plan.entries)
          if ((await text(NodePath.join(entry.gitDirectory, "gitdir"))) !== entry.previous)
            fail("backlink-changed");
        return;
      }
      const entries: Array<typeof Entry.Type> = [];
      async function visit(directory: string): Promise<void> {
        const stat = await NodeFSP.lstat(directory);
        if (!stat.isDirectory()) fail("unsupported-worktree-entry");
        const marker = NodePath.join(directory, ".git");
        if (await present(marker)) {
          const metadata = await gitDirectory(marker);
          const previous = await text(NodePath.join(metadata, "gitdir"));
          const relative = NodePath.relative(original, directory);
          entries.push({
            relative,
            gitDirectory: metadata,
            previous,
            next: `${NodePath.join(destination, relative, ".git")}\n`,
          });
          return;
        }
        for (const child of (await NodeFSP.readdir(directory, { withFileTypes: true })).sort(
          (a, b) => a.name.localeCompare(b.name),
        )) {
          if (!child.isDirectory()) fail("unclassified-worktree-entry");
          await visit(NodePath.join(directory, child.name));
        }
      }
      const worktrees = NodePath.join(original, "worktrees");
      if (await present(worktrees)) await visit(worktrees);
      // Snapshot is immutable and durable before any backlink can be modified.
      const plan = await check({
        version: 1,
        originalRoot: original,
        destinationRoot: destination,
        entries,
      });
      const temporary = `${file}.${NodeCrypto.randomUUID()}`;
      const handle = await NodeFSP.open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(encode(plan));
        await handle.sync();
      } finally {
        await handle.close();
      }
      await NodeFSP.link(temporary, file);
      await NodeFSP.unlink(temporary);
      await syncDirectory(input.directory);
      await load();
    });
  const apply = (forward: boolean) =>
    protect(async () => {
      await input.assertHeld();
      // No external writes can precede a durable plan; early preparation failures
      // therefore have nothing to undo. Forward publication requires that plan.
      if (!forward && !(await present(file))) return;
      const plan = await load();
      for (const entry of plan.entries) {
        await input.assertHeld();
        const path = NodePath.join(entry.gitDirectory, "gitdir");
        const current = await text(path),
          expected = forward ? entry.previous : entry.next,
          target = forward ? entry.next : entry.previous;
        if (current === target) continue;
        if (current !== expected) fail("backlink-conflict");
        if (
          forward &&
          (await gitDirectory(NodePath.join(destination, entry.relative, ".git"))) !==
            entry.gitDirectory
        )
          fail("candidate-pointer-changed");
        await replace(path, target, expected);
      }
    });
  return {
    prepare,
    external: { id: "git-worktrees-v1", commit: () => apply(true), rollback: () => apply(false) },
    validatePublished: () =>
      protect(async () => {
        const plan = await load();
        for (const entry of plan.entries) {
          if (
            (await text(NodePath.join(entry.gitDirectory, "gitdir"))) !== entry.next ||
            (await gitDirectory(NodePath.join(destination, entry.relative, ".git"))) !==
              entry.gitDirectory
          )
            fail("published-backlink-invalid");
        }
      }),
  };
}
