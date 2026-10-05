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

    expect(findBrandingProblems(root, ["apps/desktop/package.json"])).toContain(
      'apps/desktop/package.json: missing "productName": "Up.computer (Alpha)"',
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
      '  name: "T3 Code",',
    ].join("\n");

    expect(rebrandText(source, "apps/server/src/mcp/McpHttpServer.ts")).toBe(
      [
        "// T3 Code owns this comment.",
        'const title = "Restart Up.computer to finish.";',
        'const label = "Open an Up.computer terminal";',
        'const connect = "Sign in to UpComputer Connect";',
        '  name: "T3 Code",',
      ].join("\n"),
    );
  });

  it("is idempotent", () => {
    const once = rebrandText('const text = "Read a T3 thread in T3 Code";');
    expect(rebrandText(once)).toBe(once);
    expect(once).toBe('const text = "Read an Up.computer thread in Up.computer";');
  });
});
