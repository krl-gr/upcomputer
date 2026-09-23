// @effect-diagnostics nodeBuiltinImport:off - All filesystem/process state belongs to disposable fixtures.
import * as NodeChildProcess from "node:child_process";
import * as NodeSqlite from "node:sqlite";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import { afterEach, expect, it } from "vite-plus/test";
import {
  resolveMigratedProfileRoot,
  assertProfileMigrationStartupAllowed,
  migrateProfile,
  rollbackProfileMigration,
  profileMigrationDirectory,
  type ProfileMigrationAdapter,
  type ProfileMigrationPlan,
} from "./profileMigration.ts";

const fixtures: string[] = [];
async function fixture() {
  const home = await NodeFSP.mkdtemp(
    NodePath.join(NodeOS.tmpdir(), "upcomputer-profile-migration-"),
  );
  fixtures.push(home);
  const plan: ProfileMigrationPlan = {
    directory: profileMigrationDirectory(home),
    roots: [
      {
        id: "backend",
        source: NodePath.join(home, ".t3"),
        destination: NodePath.join(home, ".upcomputer"),
      },
      {
        id: "electron",
        source: NodePath.join(home, "t3code"),
        destination: NodePath.join(home, "UpComputer"),
      },
    ],
  };
  for (const root of plan.roots) {
    await NodeFSP.mkdir(root.source);
    await NodeFSP.writeFile(NodePath.join(root.source, "data"), `synthetic ${root.id}`);
  }
  let released = 0,
    prepared = 0;
  const adapter: ProfileMigrationAdapter = {
    acquireOfflineLease: async () => ({
      assertHeld: async () => {},
      release: async () => {
        released++;
      },
    }),
    prepare: async () => {
      prepared++;
    },
    validate: async (roots) => {
      for (const root of roots)
        expect(await NodeFSP.readFile(NodePath.join(root.source, "data"), "utf8")).toBe(
          `synthetic ${root.id}`,
        );
    },
  };
  return {
    home,
    plan,
    adapter,
    get released() {
      return released;
    },
    get prepared() {
      return prepared;
    },
  };
}
afterEach(async () => {
  for (const root of fixtures.splice(0)) await NodeFSP.rm(root, { recursive: true, force: true });
});
const interrupted = () => {
  throw new Error("simulated interruption");
};

it("copies both roots, retains verified backups, commits once and never resurrects old data", async () => {
  const f = await fixture();
  await expect(migrateProfile(f.plan, { adapter: f.adapter })).resolves.toBe("complete");
  expect(f.released).toBe(1);
  expect(f.prepared).toBe(1);
  expect(() => assertProfileMigrationStartupAllowed(f.plan.directory)).not.toThrow();
  for (const root of f.plan.roots) {
    expect(
      await NodeFSP.readFile(NodePath.join(f.plan.directory, "backup", root.id, "data"), "utf8"),
    ).toBe(`synthetic ${root.id}`);
    expect(await NodeFSP.readFile(NodePath.join(root.source, "data"), "utf8")).toBe(
      `synthetic ${root.id}`,
    );
  }
  await NodeFSP.writeFile(NodePath.join(f.plan.roots[0]!.destination, "data"), "new activity");
  await expect(migrateProfile(f.plan, { adapter: f.adapter })).resolves.toBe("complete");
  expect(await NodeFSP.readFile(NodePath.join(f.plan.roots[0]!.destination, "data"), "utf8")).toBe(
    "new activity",
  );
  await expect(rollbackProfileMigration(f.plan, { adapter: f.adapter })).rejects.toMatchObject({
    code: "activated-profile-requires-explicit-restore",
  });
});

it.each(["copying", "prepared", "publishing"] as const)(
  "resumes an interruption at %s without exposing partial roots",
  async (phase) => {
    const f = await fixture();
    await expect(
      migrateProfile(f.plan, {
        adapter: f.adapter,
        checkpoint: async (at) => {
          if (at === phase) interrupted();
        },
      }),
    ).rejects.toMatchObject({ code: "io-or-validation-failed" });
    expect(() => assertProfileMigrationStartupAllowed(f.plan.directory)).toThrow();
    await expect(migrateProfile(f.plan, { adapter: f.adapter })).resolves.toBe("complete");
    expect(f.released).toBe(2);
    expect(f.prepared).toBe(1);
  },
);

it("does not publish failed native validation, and reconstructs failed preparation from the backup", async () => {
  const f = await fixture();
  let first = true;
  const adapter = {
    ...f.adapter,
    prepare: async (roots: Parameters<ProfileMigrationAdapter["prepare"]>[0]) => {
      if (first) {
        first = false;
        await NodeFSP.writeFile(NodePath.join(roots[0]!.source, "data"), "partial rewrite");
        interrupted();
      }
    },
  };
  await expect(migrateProfile(f.plan, { adapter })).rejects.toThrow();
  await expect(NodeFSP.stat(f.plan.roots[0]!.destination)).rejects.toMatchObject({
    code: "ENOENT",
  });
  await expect(migrateProfile(f.plan, { adapter })).resolves.toBe("complete");
});

it("fails closed when source, backup, candidate, or plan changes during recovery", async () => {
  for (const target of ["source", "backup", "candidate", "plan"]) {
    const f = await fixture();
    await expect(
      migrateProfile(f.plan, {
        adapter: f.adapter,
        checkpoint: async (at) => {
          if (at === "prepared") interrupted();
        },
      }),
    ).rejects.toThrow();
    const root = f.plan.roots[0]!;
    if (target !== "plan")
      await NodeFSP.writeFile(
        NodePath.join(
          target === "source" ? root.source : NodePath.join(f.plan.directory, target, root.id),
          "data",
        ),
        "changed",
      );
    const plan =
      target === "plan"
        ? {
            ...f.plan,
            roots: f.plan.roots.map((r) => ({ ...r, destination: r.destination + "-different" })),
          }
        : f.plan;
    await expect(migrateProfile(plan, { adapter: f.adapter })).rejects.toThrow();
    await expect(NodeFSP.stat(root.destination)).rejects.toMatchObject({ code: "ENOENT" });
  }
});

it("rolls back a partly published job by quarantining copies and can resume rollback", async () => {
  const f = await fixture();
  await expect(
    migrateProfile(f.plan, {
      adapter: f.adapter,
      checkpoint: async (at) => {
        if (at === "publishing") interrupted();
      },
    }),
  ).rejects.toThrow();
  await expect(
    rollbackProfileMigration(f.plan, { adapter: f.adapter, checkpoint: async () => interrupted() }),
  ).rejects.toThrow();
  expect(() => assertProfileMigrationStartupAllowed(f.plan.directory)).toThrow();
  await expect(migrateProfile(f.plan, { adapter: f.adapter })).rejects.toMatchObject({
    code: "rollback-in-progress",
  });
  await expect(rollbackProfileMigration(f.plan, { adapter: f.adapter })).resolves.toBe(
    "rolled-back",
  );
  expect(() => assertProfileMigrationStartupAllowed(f.plan.directory)).not.toThrow();
  for (const root of f.plan.roots) {
    await expect(NodeFSP.stat(root.destination)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await NodeFSP.readFile(NodePath.join(root.source, "data"), "utf8")).toBe(
      `synthetic ${root.id}`,
    );
  }
  expect(
    await NodeFSP.readFile(
      NodePath.join(f.plan.directory, "rolled-back", "backend", "data"),
      "utf8",
    ),
  ).toBe("synthetic backend");
});

it("never overwrites a destination created by another actor", async () => {
  const f = await fixture();
  await NodeFSP.mkdir(f.plan.roots[0]!.destination);
  await NodeFSP.writeFile(NodePath.join(f.plan.roots[0]!.destination, "data"), "independent");
  await expect(migrateProfile(f.plan, { adapter: f.adapter })).rejects.toMatchObject({
    code: "destination-conflict",
  });
  expect(await NodeFSP.readFile(NodePath.join(f.plan.roots[0]!.destination, "data"), "utf8")).toBe(
    "independent",
  );
});

it("rejects live recorded owners, ambiguous owner records and native lock markers", async () => {
  const f = await fixture();
  const backend = f.plan.roots[0]!.source;
  await NodeFSP.mkdir(NodePath.join(backend, "userdata"));
  const state = NodePath.join(backend, "userdata", "server-runtime.json");
  await NodeFSP.writeFile(state, `{"pid":${process.pid}}`);
  await expect(migrateProfile(f.plan, { adapter: f.adapter })).rejects.toMatchObject({
    code: "recorded-owner-active",
  });
  await NodeFSP.writeFile(state, "invalid fixture");
  await expect(migrateProfile(f.plan, { adapter: f.adapter })).rejects.toMatchObject({
    code: "invalid-owner-record",
  });
  await NodeFSP.unlink(state);
  await NodeFSP.writeFile(NodePath.join(f.plan.roots[1]!.source, "SingletonLock"), "fixture");
  await expect(migrateProfile(f.plan, { adapter: f.adapter })).rejects.toMatchObject({
    code: "native-owner-marker-present",
  });
});

it("rejects symlinks, nested roots and corrupt journals", async () => {
  const f = await fixture();
  await NodeFSP.symlink(f.plan.roots[1]!.source, NodePath.join(f.plan.roots[0]!.source, "link"));
  await expect(migrateProfile(f.plan, { adapter: f.adapter })).rejects.toMatchObject({
    code: "unsupported-profile-entry",
  });
  await NodeFSP.unlink(NodePath.join(f.plan.roots[0]!.source, "link"));
  await expect(
    migrateProfile(
      { ...f.plan, directory: NodePath.join(f.plan.roots[0]!.source, "job") },
      { adapter: f.adapter },
    ),
  ).rejects.toMatchObject({ code: "overlapping-roots" });
  await NodeFSP.writeFile(NodePath.join(f.plan.directory, "journal.json"), "invalid");
  expect(() => assertProfileMigrationStartupAllowed(f.plan.directory)).toThrow();
  await expect(migrateProfile(f.plan, { adapter: f.adapter })).rejects.toMatchObject({
    code: "unreadable-journal",
  });
});

it("rejects competing jobs while the first job owns the maintenance mutex", async () => {
  const f = await fixture();
  let announce!: () => void, release!: () => void;
  const reached = new Promise<void>((resolve) => {
    announce = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = migrateProfile(f.plan, {
    adapter: f.adapter,
    checkpoint: async (at) => {
      if (at === "prepared") {
        announce();
        await gate;
      }
    },
  });
  await reached;
  try {
    await expect(migrateProfile(f.plan, { adapter: f.adapter })).rejects.toMatchObject({
      code: "maintenance-busy",
    });
  } finally {
    release();
  }
  await expect(first).resolves.toBe("complete");
});

it("blocks publication if the native lease is lost", async () => {
  const f = await fixture();
  let held = true;
  const adapter = {
    ...f.adapter,
    acquireOfflineLease: async () => ({
      assertHeld: async () => {
        if (!held) throw new Error("lost fixture lease");
      },
      release: async () => {},
    }),
  };
  await expect(
    migrateProfile(f.plan, {
      adapter,
      checkpoint: async (at) => {
        if (at === "prepared") held = false;
      },
    }),
  ).rejects.toThrow();
  for (const root of f.plan.roots)
    await expect(NodeFSP.stat(root.destination)).rejects.toMatchObject({ code: "ENOENT" });
  held = true;
  await expect(migrateProfile(f.plan, { adapter })).resolves.toBe("complete");
});

it.each(["copying", "prepared", "publishing"] as const)(
  "recovers a real killed subprocess at %s and a provably dead job owner",
  async (phase) => {
    const f = await fixture();
    const child = NodeChildProcess.spawn(
      process.execPath,
      [new URL("./profileMigration.crash-fixture.ts", import.meta.url).pathname, f.home, phase],
      { stdio: "ignore", env: { HOME: f.home, PATH: process.env.PATH ?? "" } },
    );
    try {
      const result = await new Promise<{ code: number | null; signal: string | null }>(
        (resolve, reject) => {
          child.once("error", reject);
          child.once("close", (code, signal) => resolve({ code, signal }));
        },
      );
      expect(result.signal).toBe("SIGKILL");
      expect(
        await NodeFSP.readFile(NodePath.join(f.plan.directory, "journal.json"), "utf8"),
      ).toContain(`"phase":"${phase}"`);
      if (phase === "publishing")
        await expect(NodeFSP.stat(f.plan.roots[0]!.destination)).resolves.toBeDefined();
      expect(() => assertProfileMigrationStartupAllowed(f.plan.directory)).toThrow();
      await expect(migrateProfile(f.plan, { adapter: f.adapter })).resolves.toBe("complete");
    } finally {
      child.kill("SIGKILL");
    }
  },
  15000,
);

it("maps only completed exact root overrides and refuses missing committed destinations", async () => {
  const f = await fixture();
  expect(resolveMigratedProfileRoot(f.plan.directory, f.plan.roots[0]!.source)).toBe(
    f.plan.roots[0]!.source,
  );
  await migrateProfile(f.plan, { adapter: f.adapter });
  const root = f.plan.roots[0]!;
  expect(resolveMigratedProfileRoot(f.plan.directory, root.source)).toBe(
    await NodeFSP.realpath(root.destination),
  );
  expect(
    resolveMigratedProfileRoot(f.plan.directory, NodePath.join(root.source, "worktrees")),
  ).toBe(NodePath.join(root.source, "worktrees"));
  await NodeFSP.rename(root.destination, root.destination + "-missing");
  expect(() => assertProfileMigrationStartupAllowed(f.plan.directory)).toThrow();
});

it("validates real SQLite candidates after structured rewriting, retaining original DB and opaque attachment bytes", async () => {
  const f = await fixture();
  const root = f.plan.roots[0]!;
  const sourceSession = NodePath.join(root.source, "session.jsonl");
  const finalSession = NodePath.join(root.destination, "session.jsonl");
  await NodeFSP.writeFile(sourceSession, "synthetic session: history is not globally rewritten");
  const bytes = Buffer.from([0, 255, 34, 128, 9]);
  await NodeFSP.writeFile(NodePath.join(root.source, "attachment.bin"), bytes);
  const db = new NodeSqlite.DatabaseSync(NodePath.join(root.source, "state.sqlite"));
  db.exec("CREATE TABLE sessions (session_file TEXT, transcript TEXT)");
  db.prepare("INSERT INTO sessions VALUES (?, ?)").run(sourceSession, sourceSession);
  db.close();
  const adapter = {
    ...f.adapter,
    prepare: async (roots: Parameters<ProfileMigrationAdapter["prepare"]>[0]) => {
      const candidate = roots.find((r) => r.id === "backend")!;
      const database = new NodeSqlite.DatabaseSync(NodePath.join(candidate.source, "state.sqlite"));
      try {
        database
          .prepare("UPDATE sessions SET session_file = ? WHERE session_file = ?")
          .run(finalSession, sourceSession);
      } finally {
        database.close();
      }
    },
    validate: async (roots: Parameters<ProfileMigrationAdapter["validate"]>[0]) => {
      const candidate = roots.find((r) => r.id === "backend")!;
      const database = new NodeSqlite.DatabaseSync(
        NodePath.join(candidate.source, "state.sqlite"),
        { readOnly: true },
      );
      try {
        expect(database.prepare("PRAGMA integrity_check").get()?.integrity_check).toBe("ok");
        expect(database.prepare("SELECT * FROM sessions").get()).toMatchObject({
          session_file: finalSession,
          transcript: sourceSession,
        });
      } finally {
        database.close();
      }
      expect(await NodeFSP.readFile(NodePath.join(candidate.source, "attachment.bin"))).toEqual(
        bytes,
      );
    },
  };
  await migrateProfile(f.plan, { adapter });
  for (const directory of [root.source, NodePath.join(f.plan.directory, "backup", "backend")]) {
    const original = new NodeSqlite.DatabaseSync(NodePath.join(directory, "state.sqlite"), {
      readOnly: true,
    });
    try {
      expect(original.prepare("SELECT session_file FROM sessions").get()?.session_file).toBe(
        sourceSession,
      );
    } finally {
      original.close();
    }
  }
});

it("preserves read-only file permissions while flushing a verified copy", async () => {
  const f = await fixture();
  const root = f.plan.roots[0]!;
  await NodeFSP.chmod(NodePath.join(root.source, "data"), 0o444);
  await migrateProfile(f.plan, { adapter: f.adapter });
  expect((await NodeFSP.stat(NodePath.join(root.destination, "data"))).mode & 0o222).toBe(0);
});

it("never publishes rejected native validation, and permits a pre-activation rollback", async () => {
  const f = await fixture();
  await expect(
    migrateProfile(f.plan, {
      adapter: {
        ...f.adapter,
        validate: async () => {
          throw new Error("fixture crypto verification failure");
        },
      },
    }),
  ).rejects.toMatchObject({ code: "io-or-validation-failed" });
  for (const root of f.plan.roots)
    await expect(NodeFSP.stat(root.destination)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(rollbackProfileMigration(f.plan, { adapter: f.adapter })).resolves.toBe(
    "rolled-back",
  );
});

it("does not follow a replaced migration control directory", async () => {
  const f = await fixture();
  await expect(
    migrateProfile(f.plan, {
      adapter: f.adapter,
      checkpoint: async (phase) => {
        if (phase === "copying") interrupted();
      },
    }),
  ).rejects.toThrow();
  await NodeFSP.symlink(f.plan.roots[0]!.source, NodePath.join(f.plan.directory, "candidate"));
  await expect(migrateProfile(f.plan, { adapter: f.adapter })).rejects.toMatchObject({
    code: "invalid-maintenance-directory",
  });
  expect(await NodeFSP.readdir(f.plan.roots[0]!.source)).toEqual(["data"]);
});

it("rejects case-only nested control paths before creating anything inside the source", async () => {
  const f = await fixture();
  const alias = NodePath.join(f.home, ".T3", "recovery");
  await expect(
    migrateProfile({ ...f.plan, directory: alias }, { adapter: f.adapter }),
  ).rejects.toMatchObject({ code: "overlapping-roots" });
  expect(await NodeFSP.readdir(f.plan.roots[0]!.source)).toEqual(["data"]);
});
