import { EnvironmentId, ProjectId } from "@upcomputer/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { BranchToolbarEnvironmentSelector } from "./BranchToolbarEnvironmentSelector";

const remoteEnvironmentId = EnvironmentId.make("environment-remote");

describe("BranchToolbarEnvironmentSelector", () => {
  it("labels a sole remote environment even without a picker", () => {
    const markup = renderToStaticMarkup(
      <BranchToolbarEnvironmentSelector
        envLocked={false}
        environmentId={remoteEnvironmentId}
        availableEnvironments={[
          {
            environmentId: remoteEnvironmentId,
            projectId: ProjectId.make("project-remote"),
            label: "Studio Mac",
            isPrimary: false,
          },
        ]}
      />,
    );

    expect(markup).toContain("Studio Mac");
    expect(markup).not.toContain('aria-label="Run on"');
  });
});
