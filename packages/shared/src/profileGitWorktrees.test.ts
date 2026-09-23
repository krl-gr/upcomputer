// @effect-diagnostics nodeBuiltinImport:off - Real Git repositories belong exclusively to disposable migration fixtures.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeChildProcess from "node:child_process";
import { afterEach, expect, it } from "vite-plus/test";
import { createGitWorktreeMigration } from "./profileGitWorktrees.ts";
import {
  assertProfileMigrationStartupAllowed,
  migrateProfile,
  rollbackProfileMigration,
  profileMigrationDirectory,
  type ProfileMigrationAdapter,
} from "./profileMigration.ts";

const homes: string[] = [];
function git(cwd: string, ...args: string[]): string {
  const result = NodeChildProcess.spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      HOME: cwd,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: NodePath.join(cwd, "no-global-config"),
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  if (result.status !== 0) throw new Error("Fixture Git command failed");
  return result.stdout;
}
async function fixture() {
  const home = await NodeFSP.realpath(
    await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "upcomputer-worktree-migration-")),
  );
  homes.push(home);
  const original = NodePath.join(home, "old"),
    destination = NodePath.join(home, "new"),
    repo = NodePath.join(home, "repo"),
    directory = profileMigrationDirectory(home);
  await NodeFSP.mkdir(original);
  await NodeFSP.mkdir(repo);
  git(repo, "init");
  git(
    repo,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@invalid",
    "commit",
    "--allow-empty",
    "-m",
    "fixture",
  );
  for (const name of ["a", "b"])
    git(repo, "worktree", "add", "--detach", NodePath.join(original, "worktrees", name), "HEAD");
  const plan = { directory, roots: [{ id: "backend" as const, source: original, destination }] };
  let writes = 0,
    stopAfterFirst = false;
  const participant = createGitWorktreeMigration({
    originalRoot: original,
    destinationRoot: destination,
    directory,
    assertHeld: async () => {
      if (stopAfterFirst && ++writes === 3) throw new Error("fixture lease lost");
    },
  });
  const adapter: ProfileMigrationAdapter = {
    acquireOfflineLease: async () => ({ assertHeld: async () => {}, release: async () => {} }),
    prepare: participant.prepare,
    validate: async (_roots, phase) => {
      if (phase === "published") await participant.validatePublished();
    },
    external: participant.external,
  };
  return {
    home,
    original,
    destination,
    repo,
    plan,
    adapter,
    participant,
    stop() {
      stopAfterFirst = true;
      writes = 0;
    },
    resume() {
      stopAfterFirst = false;
    },
  };
}
afterEach(async () => {
  for (const home of homes.splice(0)) await NodeFSP.rm(home, { recursive: true, force: true });
});

it("publishes real linked worktrees and preserves original Git pointers and files", async () => {
  const f = await fixture();
  const pointer = await NodeFSP.readFile(NodePath.join(f.original, "worktrees/a/.git"));
  await migrateProfile(f.plan, { adapter: f.adapter });
  expect(() => assertProfileMigrationStartupAllowed(f.plan.directory)).not.toThrow();
  const list = git(f.repo, "worktree", "list", "--porcelain");
  expect(list).toContain(NodePath.join(f.destination, "worktrees/a"));
  expect(list).not.toContain(NodePath.join(f.original, "worktrees/a"));
  expect(git(NodePath.join(f.destination, "worktrees/a"), "status", "--porcelain")).toBe("");
  expect(await NodeFSP.readFile(NodePath.join(f.original, "worktrees/a/.git"))).toEqual(pointer);
  await f.participant.external.commit();
  await f.participant.validatePublished();
});

it("recovers a partial external commit, or restores backlinks before quarantining candidates", async () => {
  for (const rollback of [false, true]) {
    const f = await fixture();
    await expect(
      migrateProfile(f.plan, {
        adapter: f.adapter,
        checkpoint: async (phase) => {
          if (phase === "publishing") f.stop();
        },
      }),
    ).rejects.toThrow();
    const partial = git(f.repo, "worktree", "list", "--porcelain");
    expect(partial).toContain(NodePath.join(f.destination, "worktrees/a"));
    expect(partial).toContain(NodePath.join(f.original, "worktrees/b"));
    f.resume();
    if (rollback) {
      await rollbackProfileMigration(f.plan, { adapter: f.adapter });
      expect(git(f.repo, "worktree", "list", "--porcelain")).not.toContain(f.destination);
    } else {
      await migrateProfile(f.plan, { adapter: f.adapter });
      await f.participant.validatePublished();
    }
  }
});

it("refuses changed external state and a missing/version-changed participant during recovery", async () => {
  const f = await fixture();
  await expect(
    migrateProfile(f.plan, {
      adapter: f.adapter,
      checkpoint: async (phase) => {
        if (phase === "prepared") throw new Error("fixture stop");
      },
    }),
  ).rejects.toThrow();
  expect(await NodeFSP.readFile(NodePath.join(f.plan.directory, "journal.json"), "utf8")).toContain(
    '"version":2',
  );
  const { external: _, ...withoutExternal } = f.adapter;
  await expect(migrateProfile(f.plan, { adapter: withoutExternal })).rejects.toMatchObject({
    code: "plan-mismatch",
  });
  const pointer = git(
    NodePath.join(f.original, "worktrees/a"),
    "rev-parse",
    "--absolute-git-dir",
  ).trim();
  await NodeFSP.writeFile(NodePath.join(pointer, "gitdir"), "independent change\n");
  await expect(migrateProfile(f.plan, { adapter: f.adapter })).rejects.toMatchObject({
    code: "git-backlink-conflict",
  });
  await expect(rollbackProfileMigration(f.plan, { adapter: f.adapter })).rejects.toMatchObject({
    code: "git-backlink-conflict",
  });
  expect(await NodeFSP.readFile(NodePath.join(pointer, "gitdir"), "utf8")).toBe(
    "independent change\n",
  );
});

it("rejects unsupported relative Git pointers without changing external metadata, and can abort", async () => {
  const f = await fixture();
  const file = NodePath.join(f.original, "worktrees/a/.git");
  const metadata = git(NodePath.dirname(file), "rev-parse", "--absolute-git-dir").trim();
  const before = await NodeFSP.readFile(NodePath.join(metadata, "gitdir"));
  await NodeFSP.writeFile(file, `gitdir: ${NodePath.relative(NodePath.dirname(file), metadata)}\n`);
  await expect(migrateProfile(f.plan, { adapter: f.adapter })).rejects.toMatchObject({
    code: "git-relative-git-pointer",
  });
  expect(await NodeFSP.readFile(NodePath.join(metadata, "gitdir"))).toEqual(before);
  await expect(rollbackProfileMigration(f.plan, { adapter: f.adapter })).resolves.toBe(
    "rolled-back",
  );
});

it("rejects an unversioned external participant before creating maintenance state", async () => {
  const f = await fixture();
  await expect(
    migrateProfile(f.plan, {
      adapter: { ...f.adapter, external: { ...f.participant.external, id: "" } },
    }),
  ).rejects.toMatchObject({ code: "invalid-external-participant" });
  await expect(NodeFSP.stat(f.plan.directory)).rejects.toMatchObject({ code: "ENOENT" });
});
