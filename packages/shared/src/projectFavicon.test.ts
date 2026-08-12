import { describe, expect, it } from "vite-plus/test";

import {
  deriveProjectVisualIdentityKey,
  deriveRepositoryGroupVisualIdentityKey,
  isProjectFaviconFallbackUrl,
  resolveProjectVisualIdentityKey,
  PROJECT_FAVICON_FALLBACK_MARKER,
} from "./projectFavicon.ts";

describe("project favicon", () => {
  it("normalizes workspace paths without incorporating environment or selection ids", () => {
    const local = deriveProjectVisualIdentityKey({ cwd: "/Users/example/project/" });
    const remoteRecord = deriveProjectVisualIdentityKey({ cwd: " /Users/example/project " });

    expect(local).toBe("/Users/example/project");
    expect(remoteRecord).toBe(local);
    expect(local).not.toContain("environment-id:");
  });

  it("normalizes Windows paths case-insensitively", () => {
    expect(deriveProjectVisualIdentityKey({ cwd: "C:/Code/Project/" })).toBe(
      deriveProjectVisualIdentityKey({ cwd: "c:\\code\\project" }),
    );
  });

  it("groups repository roots across local, worktree, and remote copies", () => {
    const canonicalKey = "github.com/upcomputer/upcomputer";
    const checkout = deriveProjectVisualIdentityKey({
      cwd: "/code/upcomputer",
      repositoryIdentity: { canonicalKey, rootPath: "/code/upcomputer" },
    });
    const worktree = deriveProjectVisualIdentityKey({
      cwd: "/tmp/upcomputer-feature",
      repositoryIdentity: { canonicalKey, rootPath: "/tmp/upcomputer-feature" },
    });
    const remote = deriveProjectVisualIdentityKey({
      cwd: "/srv/upcomputer",
      repositoryIdentity: { canonicalKey, rootPath: "/srv/upcomputer" },
    });

    expect(checkout).toBe(canonicalKey);
    expect(worktree).toBe(checkout);
    expect(remote).toBe(checkout);
  });

  it("keeps distinct monorepo subprojects separate", () => {
    const repositoryIdentity = {
      canonicalKey: "github.com/acme/mono",
      rootPath: "/code/mono",
    };

    expect(deriveProjectVisualIdentityKey({ cwd: "/code/mono/apps/web", repositoryIdentity })).toBe(
      "github.com/acme/mono::apps/web",
    );
    expect(deriveProjectVisualIdentityKey({ cwd: "/code/mono/apps/api", repositoryIdentity })).toBe(
      "github.com/acme/mono::apps/api",
    );
  });

  it("groups the same monorepo subproject across local, worktree, and remote copies", () => {
    const canonicalKey = "github.com/acme/mono";
    const local = deriveProjectVisualIdentityKey({
      cwd: "/code/mono/apps/web",
      repositoryIdentity: { canonicalKey, rootPath: "/code/mono" },
    });
    const worktree = deriveProjectVisualIdentityKey({
      cwd: "/tmp/mono-feature/apps/web/",
      repositoryIdentity: { canonicalKey, rootPath: "/tmp/mono-feature" },
    });
    const remote = deriveProjectVisualIdentityKey({
      cwd: "C:\\Code\\Mono\\apps\\web",
      repositoryIdentity: { canonicalKey, rootPath: "c:/code/mono" },
    });

    expect(local).toBe("github.com/acme/mono::apps/web");
    expect(worktree).toBe(local);
    expect(remote).toBe(local);
  });

  it("keeps unrelated projects distinct when repository metadata is unavailable", () => {
    expect(deriveProjectVisualIdentityKey({ cwd: "/code/one" })).not.toBe(
      deriveProjectVisualIdentityKey({ cwd: "/code/two" }),
    );
  });

  it("accepts only a typed explicit identity for a logical repository group", () => {
    const visualIdentityKey = deriveRepositoryGroupVisualIdentityKey(" github.com/acme/mono ");
    expect(
      resolveProjectVisualIdentityKey({
        cwd: "/code/mono/apps/web",
        repositoryIdentity: {
          canonicalKey: "github.com/acme/mono",
          rootPath: "/code/mono",
        },
        visualIdentityKey,
      }),
    ).toBe("github.com/acme/mono");
  });

  it("identifies fallback asset URLs by their dedicated filename", () => {
    expect(
      isProjectFaviconFallbackUrl(
        `https://environment.example/api/assets/signed-token/${PROJECT_FAVICON_FALLBACK_MARKER}`,
      ),
    ).toBe(true);
    expect(
      isProjectFaviconFallbackUrl(`/api/assets/signed-token/${PROJECT_FAVICON_FALLBACK_MARKER}`),
    ).toBe(true);
  });

  it("does not mistake real favicons or query parameters for fallbacks", () => {
    expect(
      isProjectFaviconFallbackUrl("https://environment.example/api/assets/token/favicon.svg"),
    ).toBe(false);
    expect(
      isProjectFaviconFallbackUrl(
        `https://environment.example/api/assets/token/favicon.svg?name=${PROJECT_FAVICON_FALLBACK_MARKER}`,
      ),
    ).toBe(false);
    expect(isProjectFaviconFallbackUrl(null)).toBe(false);
  });
});
