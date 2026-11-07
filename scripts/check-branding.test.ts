// @effect-diagnostics nodeBuiltinImport:off - Tests run the file check against real and temporary trees.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { findBrandingProblems } from "./check-branding.ts";
import { rebrandText } from "./lib/branding.ts";

const repoRoot = NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)));
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

describe("check-branding", () => {
  it("finds the Up.computer identity and copy intact in this tree", () => {
    expect(findBrandingProblems(repoRoot)).toEqual([]);
  });

  it("reports an identity that regressed to the upstream value", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "upc-branding-"));
    temporaryDirectories.push(root);
    NodeFS.mkdirSync(NodePath.join(root, "apps/desktop"), { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(root, "apps/desktop/package.json"),
      '{ "productName": "T3 Code (Alpha)" }\n',
    );

    NodeFS.mkdirSync(NodePath.join(root, "apps/server/src/cli"), { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(root, "apps/server/src/cli/service.ts"),
      'const next = "Run `t3 service install`.";\n',
    );

    const problems = findBrandingProblems(root, [
      "apps/desktop/package.json",
      "apps/server/src/cli/service.ts",
    ]);
    expect(problems).toContain(
      'apps/desktop/package.json: missing "productName": "Up.computer (Alpha)"',
    );
    expect(problems).toContain(
      "apps/server/src/cli/service.ts:1: T3 copy; run node scripts/apply-branding.ts",
    );
  });
});

describe("apply-branding rules", () => {
  it("rewrites copy but keeps comments and protocol identity", () => {
    const source = [
      "// T3 Code owns this comment.",
      'const title = "Restart T3 Code to finish.";',
      'const label = "Open a T3 Code terminal";',
      'const connect = "Sign in to T3 Connect";',
      'const hint = "Run `t3 up --lan`, then `t3 update`.";',
      'const CODEX_CLIENT_NAME = "T3 Code";',
    ].join("\n");

    expect(rebrandText(source, "apps/server/src/provider/CodexProvider.ts")).toBe(
      [
        "// T3 Code owns this comment.",
        'const title = "Restart Up.computer to finish.";',
        'const label = "Open an Up.computer terminal";',
        'const connect = "Sign in to UpComputer Connect";',
        'const hint = "Run `up remote --lan`, then `up update`.";',
        'const CODEX_CLIENT_NAME = "T3 Code";',
      ].join("\n"),
    );
    // The MCP server introduces itself to agents, so its name is copy.
    expect(rebrandText('  name: "T3 Code",', "apps/server/src/mcp/McpHttpServer.ts")).toBe(
      '  name: "Up.computer",',
    );
  });

  it("names the CLI `up` in command hints, but not upstream's package, MCP server or files", () => {
    const source = [
      'const usage = "Use \\"t3 --help\\" or \\"t3 ./my-project\\"; run `sudo t3 browser setup`.";',
      'const examples = [{ command: "t3 status --json" }];',
      'const upstream = "npx t3 pair, pnpm dlx t3 serve, t3@nightly, bin/t3 serve, t3.exe";',
      'const mcp = "codex mcp add t3 --url https://host/mcp";',
      'const prose = "Remove t3 from this machine?";',
    ].join("\n");

    expect(rebrandText(source, "apps/web/src/example.ts")).toBe(
      [
        'const usage = "Use \\"up --help\\" or \\"up ./my-project\\"; run `sudo up browser setup`.";',
        'const examples = [{ command: "up status --json" }];',
        'const upstream = "npx t3 pair, pnpm dlx t3 serve, t3@nightly, bin/t3 serve, t3.exe";',
        'const mcp = "codex mcp add t3 --url https://host/mcp";',
        'const prose = "Remove t3 from this machine?";',
      ].join("\n"),
    );
    // The CLI's own prose names the program, but its identifiers and tests stay upstream's.
    expect(
      rebrandText(
        'const text = `t3 is already on ${version}.`; const manifest = { t3: "./bin/t3.mjs" }; if (name === "t3") {}',
        "apps/server/src/cli/update.ts",
      ),
    ).toBe(
      'const text = `up is already on ${version}.`; const manifest = { t3: "./bin/t3.mjs" }; if (name === "t3") {}',
    );
    expect(rebrandText('it("t3 is not on PATH")', "apps/server/src/cli/update.test.ts")).toBe(
      'it("t3 is not on PATH")',
    );
    expect(
      rebrandText(
        'const help = "Data directory (equivalent to T3CODE_HOME). Or set T3CODE_PORT."; const note = "T3CODE_HOST=1 in service.env";',
        "apps/server/src/cli/config.ts",
      ),
    ).toBe(
      'const help = "Data directory (equivalent to UPCOMPUTER_HOME). Or set UPCOMPUTER_PORT."; const note = "T3CODE_HOST=1 in service.env";',
    );
    // T3 alone is the app in the CLI's prose; T3 Chat, env names and identifiers stay.
    expect(
      rebrandText(
        'const text = "Start T3, then sign in with your T3 account for T3\'s browser. Link T3 Chat with T3CODE_HOME."; const home = resolveWorktreeT3Home(); const env = "T3_UNINSTALL_RUNTIME";',
        "apps/server/src/cli/connect.ts",
      ),
    ).toBe(
      'const text = "Start Up.computer, then sign in with your Up.computer account for Up.computer\'s browser. Link T3 Chat with T3CODE_HOME."; const home = resolveWorktreeT3Home(); const env = "T3_UNINSTALL_RUNTIME";',
    );
  });

  it("rewrites the HTML render tool copy", () => {
    expect(
      rebrandText(
        'const text = "T3 fits the frame. T3 is still installing its browser in T3\'s home directory.";',
      ),
    ).toBe(
      'const text = "Up.computer fits the frame. Up.computer is still installing its browser in Up.computer\'s home directory.";',
    );
  });

  it("rewrites user docs: names, home, hosted app and the up command", () => {
    const doc = [
      "Run `t3 serve` or `npx t3 pair` on a T3 server; T3's data lives in `~/.t3/userdata`.",
      "Open app.t3.codes, sign in to T3 Connect, and keep `T3CODE_HOME` and `@t3tools/web`.",
      "t3 thread list",
      "id=$(t3 thread start .)",
      "sudo t3 browser setup",
      "t3 up --lan",
      "Run `t3 up` here, then `t3 update`.",
    ].join("\n");
    const rebranded = rebrandText(doc, "docs/user/example.md");
    expect(rebranded).toBe(
      [
        "Run `up serve` or `up pair` on an Up.computer server; Up.computer's data lives in `~/.upcomputer/userdata`.",
        "Open app.up.computer, sign in to UpComputer Connect, and keep `T3CODE_HOME` and `@t3tools/web`.",
        "up thread list",
        "id=$(up thread start .)",
        "sudo up browser setup",
        "up remote --lan",
        "Run `up remote` here, then `up update`.",
      ].join("\n"),
    );
    expect(rebrandText(rebranded, "docs/user/example.md")).toBe(rebranded);
  });

  it("is idempotent", () => {
    const once = rebrandText('const text = "Read a T3 thread in T3 Code";');
    expect(rebrandText(once)).toBe(once);
    expect(once).toBe('const text = "Read an Up.computer thread in Up.computer";');
  });
});
