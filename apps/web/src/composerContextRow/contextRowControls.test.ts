import { describe, expect, it } from "vite-plus/test";

import { hasContextRowControls, resolveContextRowControls } from "./contextRowControls";

describe("the row under the composer's controls", () => {
  it("shows the checkout and branch in a git project, and the environment when it is notable", () => {
    expect(
      resolveContextRowControls({
        isGitRepo: true,
        isScratch: false,
        showEnvironmentIndicator: true,
      }),
    ).toEqual({ environment: true, git: true });
    const environmentOnly = resolveContextRowControls({
      isGitRepo: false,
      isScratch: false,
      showEnvironmentIndicator: true,
    });
    expect(environmentOnly).toEqual({ environment: true, git: false });
    expect(hasContextRowControls(environmentOnly)).toBe(true);
  });

  it("has nothing to show without git on the only environment, or in the scratch folder", () => {
    expect(
      hasContextRowControls(
        resolveContextRowControls({
          isGitRepo: false,
          isScratch: false,
          showEnvironmentIndicator: false,
        }),
      ),
    ).toBe(false);
    expect(
      hasContextRowControls(
        resolveContextRowControls({
          isGitRepo: true,
          isScratch: true,
          showEnvironmentIndicator: true,
        }),
      ),
    ).toBe(false);
  });
});
