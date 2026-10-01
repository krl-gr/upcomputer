import * as NodeAssert from "node:assert/strict";
// @effect-diagnostics nodeBuiltinImport:off - This regression test inspects source call sites.
import * as NodeFS from "node:fs";
import { test } from "vite-plus/test";

const agentsViewSource = NodeFS.readFileSync(new URL("./AgentsView.tsx", import.meta.url), "utf8");

test("agent create and edit model options use the shared detail-row presentation", () => {
  const detailPresentationUses = agentsViewSource.match(/triggerPresentation="detail-row"/g);

  NodeAssert.equal(detailPresentationUses?.length, 2);
  NodeAssert.equal(
    agentsViewSource.includes(
      'triggerClassName="h-8 max-w-full justify-end px-0 text-sm font-normal"',
    ),
    false,
  );
});
