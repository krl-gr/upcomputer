import type { EnvironmentId } from "@t3tools/contracts";
import { StackActions, useNavigation } from "@react-navigation/native";
import { useGT } from "gt-react-native";
import { useState } from "react";

import { AppText as Text } from "../../components/ui/AppText";
import { FilePreviewModal, type FilePreviewSource } from "../../components/ui/FilePreviewModal";
import {
  normalizeNativeMarkdownUrl,
  resolveMarkdownLinkPresentation,
} from "../../lib/markdownLinks";
import { markdownFileEmbedLabel, resolveMarkdownMediaPreview } from "../../lib/markdownMedia";
import { resolveMobileMarkdownMediaSource } from "../../lib/markdownMediaSource";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import {
  SelectableMarkdownText,
  type MarkdownImageRenderer,
} from "../../native/SelectableMarkdownText";
import { useMarkdownImageSource } from "../../native/useMarkdownImageSource";
import { useMarkdownPreviewStyles } from "../files/FileMarkdownPreview";
import { fileRoutePathSegments, resolveWorkspaceFilePath } from "../files/filePath";
import {
  ThreadMarkdownImage,
  ThreadMarkdownImageUnavailable,
  ThreadMarkdownImageView,
} from "../threads/ThreadMarkdownImage";

/**
 * A task's description or output, rendered like a markdown file in its project. A task has no
 * thread, so its images and file links load through the environment and the project's folder.
 */
export function TaskMarkdown(props: {
  readonly markdown: string;
  readonly environmentId: EnvironmentId;
  /** The task's project folder; null while the project is unknown on this device. */
  readonly cwd: string | null;
}) {
  const gt = useGT();
  const navigation = useNavigation();
  const styles = useMarkdownPreviewStyles();
  const [expandedFile, setExpandedFile] = useState<FilePreviewSource | null>(null);
  const context = {
    environmentId: props.environmentId,
    threadId: undefined,
    workspaceRoot: props.cwd,
  };
  const resolveImageSource = useMarkdownImageSource({
    environmentId: props.environmentId,
    threadId: null,
    workspaceRoot: props.cwd,
  });
  const renderImage: MarkdownImageRenderer = (image) => {
    const media = resolveMobileMarkdownMediaSource(image.href, { ...context, imageEmbed: true });
    const preview = resolveMarkdownMediaPreview(image.href, { ...context, imageEmbed: true });
    if (media?.access === "direct" && media.kind !== "video") {
      return (
        <ThreadMarkdownImageView
          uri={normalizeNativeMarkdownUrl(media.uri)}
          sourceKey={media.uri}
          unavailable={false}
          alt={image.alt}
          format={media.mimeType === "image/svg+xml" ? "svg" : undefined}
          actionsSource={preview?.source.actionsSource}
          onPressPreview={setExpandedFile}
        />
      );
    }
    if (media === null || media.access !== "environment" || media.kind === "video") {
      return <ThreadMarkdownImageUnavailable alt={image.alt} />;
    }
    return (
      <ThreadMarkdownImage
        environmentId={props.environmentId}
        resource={media.resource}
        alt={image.alt}
        srcFragment={media.srcFragment}
        actionsSource={preview?.source.actionsSource}
        onPressPreview={setExpandedFile}
      />
    );
  };
  const openFile = (href: string) => {
    const preview = resolveMarkdownMediaPreview(href, context);
    if (preview && preview.kind !== "file" && preview.kind !== "video") {
      setExpandedFile(preview.source);
      return true;
    }
    const link = resolveMarkdownLinkPresentation(href);
    if (link.kind !== "file" || props.cwd === null) return false;
    navigation.dispatch(
      StackActions.push("NewTaskFile", {
        environmentId: String(props.environmentId),
        cwd: props.cwd,
        path: fileRoutePathSegments(resolveWorkspaceFilePath(props.cwd, link.path)),
        ...(link.line ? { line: String(link.line) } : {}),
      }),
    );
    return true;
  };
  return (
    <>
      <SelectableMarkdownText
        markdown={props.markdown}
        fileEmbedLabel={(href) => markdownFileEmbedLabel(href, context, false)}
        onLinkPress={(href) => {
          if (!openFile(href)) void tryOpenExternalUrl(href, "markdown-link");
        }}
        renderImage={renderImage}
        resolveImageSource={resolveImageSource}
        onImagePress={(href) => void openFile(href)}
        textStyle={styles.nativeTextStyle}
      />
      <FilePreviewModal source={expandedFile} onRequestClose={() => setExpandedFile(null)} />
      {props.markdown.trim() === "" ? (
        <Text className="text-sm text-foreground-muted">{gt("Nothing here yet.")}</Text>
      ) : null}
    </>
  );
}
