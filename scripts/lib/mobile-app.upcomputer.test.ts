// @effect-diagnostics nodeBuiltinImport:off - builds throwaway checkout roots on disk.
import { describe, expect, it } from "vite-plus/test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { mobileDepsInstalled, withoutMobile } from "./mobile-app.ts";

const files = ["apps/web/src/a.test.ts", "apps/mobile/src/b.test.ts", "apps/mobile-x/c.test.ts"];
const self = (file: string) => file;

describe("withoutMobile", () => {
  it("keeps everything when the mobile dependencies are installed", () => {
    expect(withoutMobile(files, true, self)).toEqual({ kept: files, skipped: false });
  });

  it("drops apps/mobile files when they are missing", () => {
    expect(withoutMobile(files, false, self)).toEqual({
      kept: ["apps/web/src/a.test.ts", "apps/mobile-x/c.test.ts"],
      skipped: true,
    });
  });

  it("reports no skip when nothing was in apps/mobile", () => {
    expect(withoutMobile(["apps/web/src/a.test.ts"], false, self)).toEqual({
      kept: ["apps/web/src/a.test.ts"],
      skipped: false,
    });
  });
});

describe("mobileDepsInstalled", () => {
  it("reads apps/mobile/node_modules", () => {
    const path = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mobile-app-"));
    using root = { path, [Symbol.dispose]: () => NodeFS.rmSync(path, { recursive: true }) };
    expect(mobileDepsInstalled(root.path)).toBe(false);
    NodeFS.mkdirSync(NodePath.join(root.path, "apps/mobile/node_modules"), { recursive: true });
    expect(mobileDepsInstalled(root.path)).toBe(true);
  });
});
