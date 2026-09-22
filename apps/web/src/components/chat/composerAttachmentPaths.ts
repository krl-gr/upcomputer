import { serializeComposerFileLink } from "@upcomputer/shared/composerTrigger";

function normalizeContextPickerPath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/\/+$/g, "");
}

export function workspaceRelativeContextPath(
  workspaceRoot: string,
  selectedPath: string,
): string | null {
  const normalizedRoot = normalizeContextPickerPath(workspaceRoot);
  const normalizedSelected = normalizeContextPickerPath(selectedPath);
  if (!normalizedRoot || !normalizedSelected) return null;

  const caseInsensitive = /^[a-z]:\//i.test(normalizedRoot);
  const rootForCompare = caseInsensitive ? normalizedRoot.toLowerCase() : normalizedRoot;
  const selectedForCompare = caseInsensitive
    ? normalizedSelected.toLowerCase()
    : normalizedSelected;

  if (selectedForCompare === rootForCompare) return ".";
  if (!selectedForCompare.startsWith(`${rootForCompare}/`)) return null;
  return normalizedSelected.slice(normalizedRoot.length + 1);
}

export function buildContextLinkInsertion(
  paths: ReadonlyArray<string>,
  cursor: number,
  prompt: string,
): string {
  const links = paths.map(serializeComposerFileLink).join(" ");
  if (!links) return "";
  const needsLeadingSpace = cursor > 0 && !/\s/.test(prompt[cursor - 1] ?? "");
  const needsTrailingSpace = cursor >= prompt.length || !/\s/.test(prompt[cursor] ?? "");
  return `${needsLeadingSpace ? " " : ""}${links}${needsTrailingSpace ? " " : ""}`;
}
