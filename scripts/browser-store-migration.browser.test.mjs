import * as NodeAssert from "node:assert/strict";
import * as NodeModule from "node:module";
import * as NodeTest from "node:test";
const cdp = process.env.UPCOMPUTER_TEST_CDP;
const origin = process.env.UPCOMPUTER_TEST_ORIGIN;
const require = NodeModule.createRequire(new URL("../apps/desktop/package.json", import.meta.url));
NodeTest.test(
  "browser store migration (isolated synthetic records only)",
  { skip: !cdp || !origin },
  async (t) => {
    const { chromium } = require("playwright-core");
    const browser = await chromium.connectOverCDP(cdp);
    const fixture = async (run) => {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        await page.route(`${origin}/migration-fixture`, (route) =>
          route.fulfill({ contentType: "text/html", body: "<title>Migration fixture</title>" }),
        );
        await page.goto(`${origin}/migration-fixture`);
        return await page.evaluate(run);
      } finally {
        await context.close();
      }
    };
    try {
      await t.test(
        "copies atomically, retires old writers, and never resurrects deleted data",
        async () => {
          const result = await fixture(async () => {
            const { openMigratedBrowserDatabase } = await import("/src/lib/legacyIndexedDb.ts");
            const old = await new Promise((resolve, reject) => {
              const r = indexedDB.open("t3code:connection-runtime", 4);
              r.addEventListener("upgradeneeded", () =>
                r.result.createObjectStore("catalog").put("synthetic catalog fixture", "document"),
              );
              r.addEventListener("success", () => resolve(r.result));
              r.addEventListener("error", () => reject(new Error("Fixture setup failed")));
            });
            old.close();
            const db = await openMigratedBrowserDatabase("connections");
            const value = await new Promise((resolve) => {
              const r = db.transaction("catalog").objectStore("catalog").get("document");
              r.addEventListener("success", () => resolve(r.result));
            });
            const deleted = db.transaction("catalog", "readwrite");
            deleted.objectStore("catalog").delete("document");
            await new Promise((resolve) => {
              deleted.addEventListener("complete", resolve);
            });
            db.close();
            const again = await openMigratedBrowserDatabase("connections");
            const count = await new Promise((resolve) => {
              const r = again.transaction("catalog").objectStore("catalog").count();
              r.addEventListener("success", () => resolve(r.result));
            });
            again.close();
            const retired = await new Promise((resolve) => {
              const r = indexedDB.open("t3code:connection-runtime", 4);
              r.addEventListener("error", () => resolve(r.error.name === "VersionError"));
              r.addEventListener("success", () => {
                r.result.close();
                resolve(false);
              });
            });
            return { copied: value === "synthetic catalog fixture", count, retired };
          });
          NodeAssert.deepEqual(result, { copied: true, count: 0, retired: true });
        },
      );
      await t.test(
        "refuses destination conflicts before retiring the legacy database",
        async () => {
          const result = await fixture(async () => {
            const { openMigratedBrowserDatabase } = await import("/src/lib/legacyIndexedDb.ts");
            for (const [name, version, value] of [
              ["t3code:connection-runtime", 4, "old fixture"],
              ["upcomputer:connection-runtime", 4, "new fixture"],
            ]) {
              const db = await new Promise((resolve) => {
                const r = indexedDB.open(name, version);
                r.addEventListener("upgradeneeded", () =>
                  r.result.createObjectStore("catalog").put(value, "document"),
                );
                r.addEventListener("success", () => resolve(r.result));
              });
              db.close();
            }
            let conflict = false;
            try {
              await openMigratedBrowserDatabase("connections");
            } catch (error) {
              conflict = error.message.includes("independent state");
            }
            const oldStillReadable = await new Promise((resolve) => {
              const r = indexedDB.open("t3code:connection-runtime", 4);
              r.addEventListener("success", () => {
                r.result.close();
                resolve(true);
              });
              r.addEventListener("error", () => resolve(false));
            });
            return { conflict, oldStillReadable };
          });
          NodeAssert.deepEqual(result, { conflict: true, oldStillReadable: true });
        },
      );
      await t.test(
        "serializes new clients and does not create an absent legacy database",
        async () => {
          const result = await fixture(async () => {
            const { openMigratedBrowserDatabase } = await import("/src/lib/legacyIndexedDb.ts");
            const databases = await Promise.all([
              openMigratedBrowserDatabase("connections"),
              openMigratedBrowserDatabase("connections"),
            ]);
            databases.forEach((db) => db.close());
            return (await indexedDB.databases()).map((db) => db.name).sort();
          });
          NodeAssert.deepEqual(result, ["upcomputer:connection-runtime"]);
        },
      );
      await t.test("preserves a non-extractable test CryptoKey without exporting it", async () => {
        const result = await fixture(async () => {
          const { openMigratedBrowserDatabase } = await import("/src/lib/legacyIndexedDb.ts");
          const pair = await crypto.subtle.generateKey(
            { name: "ECDSA", namedCurve: "P-256" },
            false,
            ["sign", "verify"],
          );
          const old = await new Promise((resolve) => {
            const r = indexedDB.open("t3code:cloud-auth", 1);
            r.addEventListener("upgradeneeded", () =>
              r.result
                .createObjectStore("keys")
                .put({ privateKey: pair.privateKey }, "fixture-key"),
            );
            r.addEventListener("success", () => resolve(r.result));
          });
          old.close();
          const db = await openMigratedBrowserDatabase("proofKeys");
          const copy = await new Promise((resolve) => {
            const r = db.transaction("keys").objectStore("keys").get("fixture-key");
            r.addEventListener("success", () => resolve(r.result));
          });
          db.close();
          const data = new TextEncoder().encode("migration fixture");
          const signature = await crypto.subtle.sign(
            { name: "ECDSA", hash: "SHA-256" },
            copy.privateKey,
            data,
          );
          return {
            extractable: copy.privateKey.extractable,
            valid: await crypto.subtle.verify(
              { name: "ECDSA", hash: "SHA-256" },
              pair.publicKey,
              signature,
              data,
            ),
          };
        });
        NodeAssert.deepEqual(result, { extractable: false, valid: true });
      });
      await t.test(
        "failure leaves no partial destination and retries from retained source",
        async () => {
          const result = await fixture(async () => {
            const { openMigratedBrowserDatabase } = await import("/src/lib/legacyIndexedDb.ts");
            const old = await new Promise((resolve) => {
              const r = indexedDB.open("t3code:connection-runtime", 4);
              r.addEventListener("upgradeneeded", () =>
                r.result.createObjectStore("catalog").put("fixture", "document"),
              );
              r.addEventListener("success", () => resolve(r.result));
            });
            old.close();
            const put = IDBObjectStore.prototype.put;
            IDBObjectStore.prototype.put = function (...args) {
              if (this.name === "catalog")
                throw new DOMException("fixture quota", "QuotaExceededError");
              return Reflect.apply(put, this, args);
            };
            let failed = false;
            try {
              await openMigratedBrowserDatabase("connections");
            } catch {
              failed = true;
            } finally {
              IDBObjectStore.prototype.put = put;
            }
            const db = await openMigratedBrowserDatabase("connections");
            const value = await new Promise((resolve) => {
              const r = db.transaction("catalog").objectStore("catalog").get("document");
              r.addEventListener("success", () => resolve(r.result));
            });
            db.close();
            return { failed, recovered: value === "fixture" };
          });
          NodeAssert.deepEqual(result, { failed: true, recovered: true });
        },
      );
      await t.test("blocks live legacy owners; cancelled upgrade is safe to retry", async () => {
        const result = await fixture(async () => {
          const { openMigratedBrowserDatabase } = await import("/src/lib/legacyIndexedDb.ts");
          const old = await new Promise((resolve) => {
            const r = indexedDB.open("t3code:connection-runtime", 4);
            r.addEventListener("upgradeneeded", () => r.result.createObjectStore("catalog"));
            r.addEventListener("success", () => resolve(r.result));
          });
          let blocked = false;
          try {
            await openMigratedBrowserDatabase("connections");
          } catch (error) {
            blocked = error.message.includes("Close other app tabs");
          } finally {
            old.close();
          }
          const db = await openMigratedBrowserDatabase("connections");
          db.close();
          return blocked;
        });
        NodeAssert.equal(result, true);
      });
    } finally {
      await browser.close();
    }
  },
);
