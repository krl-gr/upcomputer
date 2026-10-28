import { describe, expect, it } from "vite-plus/test";

import { errorClassOf, fingerprintError } from "./errorFingerprint.ts";

const withStack = <E extends Error>(error: E, stack: string): E => {
  error.stack = stack;
  return error;
};

const macStack = [
  "TypeError: Cannot read properties of undefined (reading 'title') in /Users/alice/secret-project",
  "    at renderThreadRow (/Users/alice/Applications/Up.computer.app/Contents/Resources/app/server/dist/bin.mjs:48211:17)",
  "    at async Promise.all (index 0)",
  "    at ProviderSessionManager.open (/Users/alice/Applications/Up.computer.app/Contents/Resources/app/server/dist/bin.mjs:9120:5)",
  "    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)",
].join("\n");

const windowsStack = [
  "TypeError: Cannot read properties of undefined (reading 'title') in C:\\Users\\bob\\work",
  "    at renderThreadRow (C:\\Users\\bob\\AppData\\Local\\Programs\\Up.computer\\resources\\app\\server\\dist\\bin.mjs:48230:9)",
  "    at async Promise.all (index 0)",
  "    at ProviderSessionManager.open (C:\\Users\\bob\\AppData\\Local\\Programs\\Up.computer\\resources\\app\\server\\dist\\bin.mjs:9131:12)",
  "    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)",
].join("\n");

describe("fingerprintError", () => {
  it("gives the same hash for the same error on different machines and builds", () => {
    const mac = fingerprintError(withStack(new TypeError("a"), macStack));
    const windows = fingerprintError(withStack(new TypeError("b"), windowsStack));
    expect(mac).toEqual(windows);
    expect(mac.stackHash).toMatch(/^[0-9a-f]{16}$/);
    expect(mac.module).toBe("bin.mjs");
    expect(mac.errorClass).toBe("TypeError");
  });

  it("ignores bundler content hashes but tells different call paths apart", () => {
    const web = (chunk: string, fn: string) =>
      fingerprintError(
        withStack(
          new Error("x"),
          `Error: x\n    at ${fn} (https://app.up.computer/assets/${chunk}:1:2345)\n    at commitRoot (https://app.up.computer/assets/${chunk}:9:1)`,
        ),
      );
    expect(web("index-DkX9a2bc.js", "Sidebar").stackHash).toBe(
      web("index-Qw81ZZp0.js", "Sidebar").stackHash,
    );
    expect(web("index-DkX9a2bc.js", "Sidebar").stackHash).not.toBe(
      web("index-DkX9a2bc.js", "Composer").stackHash,
    );
    expect(web("index-DkX9a2bc.js", "Sidebar").module).toBe("index-DkX9a2bc.js");
  });

  it("reads Firefox and Safari stacks", () => {
    const fingerprint = fingerprintError(
      withStack(
        new RangeError("x"),
        "layout@https://app.up.computer/assets/ChatView-Ab12Cd34.js:3:10\n@https://app.up.computer/assets/index-DkX9a2bc.js:1:1",
      ),
    );
    expect(fingerprint).toMatchObject({ errorClass: "RangeError", module: "ChatView-Ab12Cd34.js" });
  });

  it("never takes a module or hash input from the message", () => {
    const fromMessage = fingerprintError(
      withStack(
        new Error("x"),
        "Error: mail me@alice-secret.js\n    at run (/srv/app/main.cjs:1:1)",
      ),
    );
    expect(fromMessage.module).toBe("main.cjs");
    const otherMessage = fingerprintError(
      withStack(new Error("y"), "Error: something else\n    at run (/srv/app/main.cjs:1:1)"),
    );
    expect(fromMessage.stackHash).toBe(otherMessage.stackHash);
  });

  it("skips stack lines inside a multi-line message", () => {
    const childStderr = [
      "build failed:",
      "    at buildPayroll (/Users/alice/Documents/build-payroll.js:3:9)",
      "    at /Users/alice/Documents/build-payroll.js:10:1",
    ].join("\n");
    const fingerprint = fingerprintError(new Error(childStderr));
    expect(fingerprint.module).not.toBe("build-payroll.js");
    const otherOutput = fingerprintError(new Error("build failed:\n    at other (/tmp/x.js:1:1)"));
    expect(fingerprint.stackHash).toBe(otherOutput.stackHash);
  });

  it("handles values that are not errors", () => {
    expect(fingerprintError("boom")).toEqual(fingerprintError(42));
    expect(fingerprintError(undefined).errorClass).toBe("other");
    expect(fingerprintError(null).module).toBeUndefined();
  });
});

describe("errorClassOf", () => {
  it("keeps whitelisted constructor names and tags", () => {
    expect(errorClassOf(new SyntaxError("x"))).toBe("SyntaxError");
    expect(errorClassOf({ _tag: "SqlError" })).toBe("SqlError");
    expect(errorClassOf({ _tag: "TimeoutError", message: "x" })).toBe("TimeoutError");
  });

  it("sends anything else as other", () => {
    class CustomerAcmeError extends Error {}
    expect(errorClassOf(new CustomerAcmeError("x"))).toBe("other");
    expect(errorClassOf({ _tag: "acme/secret-project" })).toBe("other");
    expect(errorClassOf(Object.create(null))).toBe("other");
    expect(errorClassOf("TypeError")).toBe("other");
  });
});
