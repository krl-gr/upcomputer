import type { EnvironmentId } from "@upcomputer/contracts";
import {
  isProjectFaviconFallbackUrl,
  resolveProjectVisualIdentityKey,
  type ProjectVisualIdentityKey,
  type ProjectVisualIdentityInput,
  type ProjectVisualIdentityOverride,
} from "@upcomputer/shared/projectFavicon";
import type { CSSProperties } from "react";
import { useState } from "react";
import { useAssetUrl } from "../assets/assetUrls";
import { cn } from "../lib/utils";

const loadedProjectFaviconSrcs = new Set<string>();
const PROJECT_AVATAR_COLOR_KEYS = ["pink", "mint", "orange", "purple", "cyan", "lime"] as const;
type ProjectAvatarColorKey = (typeof PROJECT_AVATAR_COLOR_KEYS)[number];

function hashProjectAvatarSeed(seed: string): number {
  let hash = 5381;

  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 33) ^ seed.charCodeAt(index);
  }

  return hash >>> 0;
}

export function resolveProjectAvatarColorKey(
  identityKey: ProjectVisualIdentityKey,
): ProjectAvatarColorKey {
  return (
    PROJECT_AVATAR_COLOR_KEYS[
      hashProjectAvatarSeed(identityKey) % PROJECT_AVATAR_COLOR_KEYS.length
    ] ?? "lime"
  );
}

export function resolveProjectAvatarLetter(label: string): string {
  const pathSegments = label.trim().split(/[\\/]/);
  let projectName: string | undefined;

  for (let index = pathSegments.length - 1; index >= 0; index -= 1) {
    const segment = pathSegments[index]?.trim();
    if (segment) {
      projectName = segment;
      break;
    }
  }

  return (projectName?.match(/[\p{L}\p{N}]/u)?.[0] ?? "P").toLocaleUpperCase();
}

export function resolveProjectAvatarFallback(
  input: ProjectVisualIdentityInput & ProjectVisualIdentityOverride,
) {
  const identityKey = resolveProjectVisualIdentityKey(input);
  const colorKey = resolveProjectAvatarColorKey(identityKey);
  return {
    identityKey,
    colorKey,
    letter: resolveProjectAvatarLetter(identityKey),
    background: "var(--project-avatar-background)",
    text: `var(--project-avatar-text-${colorKey})`,
  } as const;
}

/**
 * Kept as a named export for call sites and tests; the actual shape is owned by
 * `@upcomputer/shared/projectFavicon`, which the asset route emits.
 */
export function isServerProjectFaviconFallbackUrl(src: string): boolean {
  return isProjectFaviconFallbackUrl(src);
}

type ProjectFaviconInput = ProjectVisualIdentityInput &
  ProjectVisualIdentityOverride & {
    environmentId: EnvironmentId;
    className?: string | undefined;
  };

function ProjectAvatarFallback(input: Omit<ProjectFaviconInput, "environmentId">) {
  const fallback = resolveProjectAvatarFallback(input);
  const style = {
    background: fallback.background,
    color: fallback.text,
  } as CSSProperties;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-grid size-3.5 shrink-0 place-items-center rounded-[4px] text-[9px] leading-none font-semibold not-italic select-none",
        input.className,
      )}
      style={style}
    >
      {fallback.letter}
    </span>
  );
}

export function ProjectFavicon(input: ProjectFaviconInput) {
  const src = useAssetUrl(input.environmentId, {
    _tag: "project-favicon",
    cwd: input.cwd,
  });

  if (!src) {
    return <ProjectAvatarFallback {...input} />;
  }

  if (isServerProjectFaviconFallbackUrl(src)) {
    return <ProjectAvatarFallback {...input} />;
  }

  return <ProjectFaviconImage key={src} src={src} input={input} />;
}

function ProjectFaviconImage({
  src,
  input,
}: {
  readonly src: string;
  readonly input: ProjectFaviconInput;
}) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(() =>
    loadedProjectFaviconSrcs.has(src) ? "loaded" : "loading",
  );

  return (
    <>
      {status !== "loaded" ? <ProjectAvatarFallback {...input} /> : null}
      <img
        src={src}
        alt=""
        className={cn(
          "size-3.5 shrink-0 rounded-sm object-contain",
          status === "loaded" ? "" : "hidden",
          input.className,
        )}
        onLoad={() => {
          loadedProjectFaviconSrcs.add(src);
          setStatus("loaded");
        }}
        onError={() => setStatus("error")}
      />
    </>
  );
}
