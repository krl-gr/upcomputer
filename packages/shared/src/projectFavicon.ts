import { normalizeProjectPathForComparison } from "./path.ts";

export const PROJECT_FAVICON_FALLBACK_MARKER = "project-favicon-missing";

declare const projectVisualIdentityBrand: unique symbol;

/** A canonical avatar seed. Construct this only with deriveProjectVisualIdentityKey. */
export type ProjectVisualIdentityKey = string & {
  readonly [projectVisualIdentityBrand]: true;
};

export interface ProjectVisualIdentityInput {
  readonly cwd: string;
  readonly repositoryIdentity?:
    | {
        readonly canonicalKey: string;
        readonly rootPath?: string | undefined;
      }
    | null
    | undefined;
}

export interface ProjectVisualIdentityOverride {
  /** Explicit identity for a row representing a logical project group. */
  readonly visualIdentityKey?: ProjectVisualIdentityKey | undefined;
}

function deriveRepositoryRelativeProjectPath(input: ProjectVisualIdentityInput): string | null {
  const rootPath = input.repositoryIdentity?.rootPath?.trim();
  if (!rootPath) return null;

  const projectPath = normalizeProjectPathForComparison(input.cwd);
  const repositoryRootPath = normalizeProjectPathForComparison(rootPath);
  if (!projectPath || !repositoryRootPath) return null;
  if (projectPath === repositoryRootPath) return "";

  const separator = repositoryRootPath.includes("\\") ? "\\" : "/";
  const repositoryRootPrefix = repositoryRootPath.endsWith(separator)
    ? repositoryRootPath
    : `${repositoryRootPath}${separator}`;
  if (!projectPath.startsWith(repositoryRootPrefix)) return null;

  return projectPath.slice(repositoryRootPrefix.length).replaceAll("\\", "/");
}

/**
 * Canonical fallback-avatar identity invariant: repository roots and corresponding
 * subprojects across copies/worktrees share `canonicalKey[::relative/path]`.
 * Projects without repository metadata use a normalized, environment-independent
 * workspace path. UI selection keys must never be used as avatar identity.
 */
export function deriveProjectVisualIdentityKey(
  input: ProjectVisualIdentityInput,
): ProjectVisualIdentityKey {
  const repositoryKey = input.repositoryIdentity?.canonicalKey.trim();
  if (repositoryKey) {
    const relativeProjectPath = deriveRepositoryRelativeProjectPath(input);
    return (
      relativeProjectPath ? `${repositoryKey}::${relativeProjectPath}` : repositoryKey
    ) as ProjectVisualIdentityKey;
  }

  return normalizeProjectPathForComparison(input.cwd) as ProjectVisualIdentityKey;
}

/** Canonical identity for a row that intentionally represents an entire repository. */
export function deriveRepositoryGroupVisualIdentityKey(
  repositoryCanonicalKey: string,
): ProjectVisualIdentityKey {
  return repositoryCanonicalKey.trim() as ProjectVisualIdentityKey;
}

export function resolveProjectVisualIdentityKey(
  input: ProjectVisualIdentityInput & ProjectVisualIdentityOverride,
): ProjectVisualIdentityKey {
  return input.visualIdentityKey ?? deriveProjectVisualIdentityKey(input);
}

export function isProjectFaviconFallbackUrl(url: string | null | undefined): boolean {
  if (!url) return false;

  try {
    const pathname = new URL(url, "https://t3.invalid").pathname;
    return pathname.slice(pathname.lastIndexOf("/") + 1) === PROJECT_FAVICON_FALLBACK_MARKER;
  } catch {
    return false;
  }
}
