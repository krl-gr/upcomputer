import type { EnvironmentId } from "@t3tools/contracts";
import {
  isProjectFaviconFallbackUrl,
  resolveProjectVisualIdentityKey,
  type ProjectVisualIdentityKey,
  type ProjectVisualIdentityInput,
  type ProjectVisualIdentityOverride,
} from "@t3tools/shared/projectFavicon";
import type { ComponentType, CSSProperties } from "react";
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
    background: `var(--project-avatar-background-${colorKey})`,
    text: `var(--project-avatar-text-${colorKey})`,
  } as const;
}

/**
 * Kept as a named export for call sites and tests; the actual shape is owned by
 * `@t3tools/shared/projectFavicon`, which the asset route emits.
 */
export function isServerProjectFaviconFallbackUrl(src: string): boolean {
  return isProjectFaviconFallbackUrl(src);
}

type ProjectFaviconInput = ProjectVisualIdentityInput &
  ProjectVisualIdentityOverride & {
    environmentId: EnvironmentId;
    className?: string | undefined;
    /**
     * Accepted for upstream call sites (SidebarV2) and ignored: this fork always
     * falls back to the coloured project avatar, never a generic icon.
     */
    fallbackIcon?: ComponentType<{ className?: string }> | undefined;
  };

function ProjectAvatarFallback(input: Omit<ProjectFaviconInput, "environmentId">) {
  const fallback = resolveProjectAvatarFallback(input);
  const style = {
    "--project-avatar-background": fallback.background,
    "--project-avatar-text": fallback.text,
  } as CSSProperties;

  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={cn("size-3.5 shrink-0 text-muted-foreground/35", input.className)}
      style={style}
    >
      <path
        d="M1 11.9474V3.05263C1 2.50824 1.20128 1.9863 1.5593 1.60136C1.91733 1.21641 2.40277 1 2.90909 1H5.4098C5.72582 1.00006 6.03705 1.08471 6.31525 1.24589C6.59346 1.40709 6.83061 1.63964 7.00444 1.92342L7.51589 2.73792L7.51962 2.74267C7.57815 2.81062 7.6581 2.86642 7.75204 2.90467C7.84591 2.94288 7.95083 2.96244 8.05717 2.96167H13.0909C13.5972 2.96167 14.0827 3.11554 14.4407 3.38923C14.7987 3.66291 15 4.034 15 4.42105V11.9474C15 12.4918 14.7987 13.0137 14.4407 13.3986C14.0827 13.7836 13.5972 14 13.0909 14H2.90909C2.40277 14 1.91733 13.7836 1.5593 13.3986C1.20128 13.0137 1 12.4918 1 11.9474Z"
        fill="currentColor"
      />
      <text
        x="8"
        y="10.9"
        textAnchor="middle"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace"
        fontSize="7.6"
        fontWeight="600"
        fill="var(--project-avatar-text)"
      >
        {fallback.letter}
      </text>
    </svg>
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
