// @effect-diagnostics nodeBuiltinImport:off -- Checks for a real zsh to run the startup file with.
import * as NodeFS from "node:fs";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { makeZshPromptMarks } from "./zshPromptMarks.ts";

const ZSH = "/bin/zsh";
const log = (name: string) => `print -r -- "${name} ZDOTDIR=\${ZDOTDIR-unset}" >> "$HOME/log"\n`;

describe("zsh prompt marks", () => {
  it.effect(
    "starts only zsh from the marks file, keeps the user's ZDOTDIR, and heals the file",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = yield* fs.makeTempDirectoryScoped();
        const marks = `${root}/shell-integration/zsh`;
        const withMarks = yield* makeZshPromptMarks(marks, "darwin");

        expect(yield* withMarks("/bin/bash", { ZDOTDIR: "/cfg" })).toEqual({ ZDOTDIR: "/cfg" });
        expect(yield* withMarks("/bin/zsh", { ZDOTDIR: "/cfg" })).toEqual({
          ZDOTDIR: marks,
          T3CODE_ZSH_ZDOTDIR: "/cfg",
        });
        expect(yield* withMarks("zsh", { T3CODE_ZSH_ZDOTDIR: "stale" })).toEqual({
          ZDOTDIR: marks,
        });

        yield* fs.remove(`${marks}/.zshenv`);
        yield* withMarks("/bin/zsh", {});
        expect(yield* fs.readFileString(`${marks}/.zshenv`)).toContain("133;A");
        expect(yield* fs.readDirectory(marks)).toEqual([".zshenv"]);

        const windows = yield* makeZshPromptMarks(marks, "win32");
        expect(yield* windows("zsh.exe", { ZDOTDIR: "/cfg" })).toEqual({ ZDOTDIR: "/cfg" });

        // A file that cannot be written leaves zsh's startup untouched.
        yield* fs.writeFileString(`${root}/blocked`, "");
        const blocked = yield* makeZshPromptMarks(`${root}/blocked/zsh`, "darwin");
        expect(yield* blocked("/bin/zsh", { ZDOTDIR: "/cfg" })).toEqual({ ZDOTDIR: "/cfg" });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live.runIf(NodeFS.existsSync(ZSH))("reads the user's startup files in zsh's own order", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const root = yield* fs.makeTempDirectoryScoped();
      const withMarks = yield* makeZshPromptMarks(`${root}/marks`, "darwin");

      const start = Effect.fn("zshPromptMarks.test.start")(function* (input: {
        readonly zdotdir?: string;
        readonly zshenv?: string;
        readonly marks: boolean;
      }) {
        const home = yield* fs.makeTempDirectoryScoped({ directory: root });
        yield* fs.makeDirectory(`${home}/cfg`);
        yield* fs.writeFileString(`${home}/.zshenv`, log("home/.zshenv") + (input.zshenv ?? ""));
        yield* fs.writeFileString(`${home}/.zshrc`, log("home/.zshrc"));
        yield* fs.writeFileString(`${home}/cfg/.zshenv`, log("cfg/.zshenv"));
        yield* fs.writeFileString(`${home}/cfg/.zshrc`, log("cfg/.zshrc"));
        const base = {
          HOME: home,
          PATH: "/usr/bin:/bin",
          ...(input.zdotdir === undefined ? {} : { ZDOTDIR: `${home}/${input.zdotdir}` }),
        };
        const env = input.marks ? yield* withMarks(ZSH, base) : base;
        const child = yield* spawner.spawn(
          ChildProcess.make(
            ZSH,
            ["-i", "-c", 'print -r -- "end ZDOTDIR=${ZDOTDIR-unset} ${+T3CODE_ZSH_ZDOTDIR}"'],
            { env, cwd: home },
          ),
        );
        const [stdout, exitCode] = yield* Effect.all(
          [child.stdout.pipe(Stream.decodeText(), Stream.mkString), child.exitCode],
          { concurrency: "unbounded" },
        );
        expect(Number(exitCode)).toBe(0);
        const startup = (yield* fs.readFileString(`${home}/log`)) + stdout;
        return startup.replaceAll(home, "~").trim().split("\n");
      }, Effect.scoped);

      for (const input of [{}, { zdotdir: "cfg" }, { zshenv: 'export ZDOTDIR="$HOME/cfg"\n' }]) {
        const plain = yield* start({ ...input, marks: false });
        expect(yield* start({ ...input, marks: true })).toEqual(plain);
      }
      expect(yield* start({ zshenv: 'export ZDOTDIR="$HOME/cfg"\n', marks: true })).toEqual([
        "home/.zshenv ZDOTDIR=unset",
        "cfg/.zshrc ZDOTDIR=~/cfg",
        "end ZDOTDIR=~/cfg 0",
      ]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
