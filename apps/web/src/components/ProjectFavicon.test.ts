import { deriveProjectVisualIdentityKey } from "@upcomputer/shared/projectFavicon";
import { describe, expect, it } from "vite-plus/test";

import {
  isServerProjectFaviconFallbackUrl,
  resolveProjectAvatarColorKey,
  resolveProjectAvatarFallback,
} from "./ProjectFavicon";

describe("project avatar fallback", () => {
  it("resolves matching subproject records across active-project surfaces", () => {
    const canonicalKey = "github.com/acme/mono";
    const surfaces = {
      sidebarMember: {
        cwd: "/code/mono/apps/web",
        repositoryIdentity: { canonicalKey, rootPath: "/code/mono" },
      },
      chatHeader: {
        cwd: "/code/mono/apps/web/",
        repositoryIdentity: { canonicalKey, rootPath: "/code/mono" },
      },
      branchToolbar: {
        cwd: "/worktrees/feature/apps/web",
        repositoryIdentity: { canonicalKey, rootPath: "/worktrees/feature" },
      },
      tasksList: {
        cwd: "/srv/mono/apps/web",
        repositoryIdentity: { canonicalKey, rootPath: "/srv/mono" },
      },
      taskDetail: {
        cwd: "C:\\Code\\Mono\\apps\\web",
        repositoryIdentity: { canonicalKey, rootPath: "c:/code/mono" },
      },
      agents: {
        cwd: "/code/mono/apps/web",
        repositoryIdentity: { canonicalKey, rootPath: "/code/mono" },
      },
      automations: {
        cwd: "/srv/mono/apps/web",
        repositoryIdentity: { canonicalKey, rootPath: "/srv/mono" },
      },
    };
    const fallbacks = Object.values(surfaces).map(resolveProjectAvatarFallback);

    expect(new Set(fallbacks.map((fallback) => fallback.identityKey))).toEqual(
      new Set([`${canonicalKey}::apps/web`]),
    );
    expect(new Set(fallbacks.map((fallback) => fallback.colorKey))).toHaveLength(1);
    expect(new Set(fallbacks.map((fallback) => fallback.background))).toHaveLength(1);
    expect(new Set(fallbacks.map((fallback) => fallback.text))).toHaveLength(1);
    expect(new Set(fallbacks.map((fallback) => fallback.letter))).toEqual(new Set(["W"]));
  });

  it("does not derive palette identity from an environment-scoped selection key", () => {
    const identity = deriveProjectVisualIdentityKey({ cwd: "/Users/example/upcomputer" });
    expect(identity).toBe("/Users/example/upcomputer");
    expect(identity).not.toBe("environment-id:project-id");
  });

  it("keeps deterministic palette choices for distinct projects", () => {
    const first = deriveProjectVisualIdentityKey({ cwd: "/code/alpha" });
    const second = deriveProjectVisualIdentityKey({ cwd: "/code/bravo" });
    expect(resolveProjectAvatarColorKey(first)).toBe(resolveProjectAvatarColorKey(first));
    expect(resolveProjectAvatarColorKey(first)).not.toBe(resolveProjectAvatarColorKey(second));
  });
});

describe("isServerProjectFaviconFallbackUrl", () => {
  // The asset route now emits the shared PROJECT_FAVICON_FALLBACK_MARKER rather
  // than a filename-shaped placeholder.
  it("recognizes the signed server fallback asset", () => {
    expect(
      isServerProjectFaviconFallbackUrl(
        "http://localhost:13773/api/assets/token/project-favicon-missing",
      ),
    ).toBe(true);
  });

  it("keeps real project favicons", () => {
    expect(
      isServerProjectFaviconFallbackUrl("http://localhost:13773/api/assets/token/favicon.svg"),
    ).toBe(false);
    expect(
      isServerProjectFaviconFallbackUrl("http://localhost:13773/api/assets/token/icon.png"),
    ).toBe(false);
  });
});
