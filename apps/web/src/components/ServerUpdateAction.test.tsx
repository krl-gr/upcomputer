import { renderToStaticMarkup } from "react-dom/server";
import type { EnvironmentId, ServerSelfUpdateCapability } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { ServerUpdateAction } from "./ServerUpdateAction";

function renderAction(selfUpdate: ServerSelfUpdateCapability | null): string {
  return renderToStaticMarkup(
    <ServerUpdateAction
      environmentId={"env-test" as EnvironmentId}
      serverLabel="Test server"
      selfUpdate={selfUpdate}
      targetVersion="0.0.29"
    />,
  );
}

describe("ServerUpdateAction", () => {
  it("does not render npm-backed update or copy-command controls", () => {
    for (const capability of ["boot-service", "respawn", null] as const) {
      const html = renderAction(capability);
      expect(html).toContain("Official remote server installation and updates are not available");
      expect(html).not.toContain("<button");
      expect(html).not.toContain("npx t3");
      expect(html).not.toContain("Update server");
      expect(html).not.toContain("Copy update command");
    }
  });

  it("keeps the bundled Desktop update path", () => {
    const html = renderAction("desktop-managed");
    expect(html).toContain("Update the desktop app on that machine");
    expect(html).not.toContain("<button");
  });
});
