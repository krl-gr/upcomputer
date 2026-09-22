import {
  SelectableMarkdownText as T3SelectableMarkdownText,
  type SelectableMarkdownTextProps,
} from "@upcomputer/mobile-markdown-text/renderer";

import { highlightCodeSnippet } from "../features/review/shikiReviewHighlighter";

type MobileSelectableMarkdownTextProps = Omit<SelectableMarkdownTextProps, "highlightCode">;

export type {
  NativeMarkdownTextStyle,
  SelectableMarkdownSkill,
} from "@upcomputer/mobile-markdown-text/types";

export function hasNativeSelectableMarkdownText(): boolean {
  return true;
}

export function SelectableMarkdownText(props: MobileSelectableMarkdownTextProps) {
  return <T3SelectableMarkdownText {...props} highlightCode={highlightCodeSnippet} />;
}
