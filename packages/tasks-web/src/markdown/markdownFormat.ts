import { remarkStringifyOptionsCtx } from "@milkdown/core";
import type { Ctx } from "@milkdown/ctx";
import { commonmark, remarkPreserveEmptyLinePlugin } from "@milkdown/preset-commonmark";
import { gfm } from "@milkdown/preset-gfm";

interface MdastParent {
  readonly type: string;
  readonly spread?: unknown;
}

/**
 * Milkdown 7.20 parses a list's `spread` into the string "false", which
 * remark-stringify reads as true, so every tight list came back with blank
 * lines between its items. A list is loose when it was parsed loose (or set
 * loose by a paste); an item only when it was parsed loose, since items made in
 * the editor default to `true`.
 */
function joinListChildren(
  left: { readonly type: string },
  right: { readonly type: string },
  parent: MdastParent,
): number | undefined {
  if (parent.type !== "list" && parent.type !== "listItem") return undefined;
  // Two paragraphs always need a blank line, or they read back as one.
  if (left.type === "paragraph" && (right.type === "paragraph" || right.type === "definition"))
    return undefined;
  const spread =
    parent.type === "list"
      ? parent.spread === true || parent.spread === "true"
      : parent.spread === "true";
  return spread ? 1 : 0;
}

/**
 * The markdown our editors read and write: CommonMark and GFM, written the way
 * agents write it (`-` bullets, `---` rules, tight lists stay tight). Empty
 * paragraphs are dropped instead of written as `<br />`, so the text agents
 * read stays plain markdown.
 */
export const markdownPresets = [
  ...commonmark.filter((plugin) => !remarkPreserveEmptyLinePlugin.includes(plugin)),
  ...gfm,
];

// An underscore between letters or digits can never start emphasis, so
// `file\_name.ts` is only noise for the agents that read the text.
const INTRAWORD_UNDERSCORE_ESCAPE = /(?<=[\p{L}\p{N}])\\_(?=[\p{L}\p{N}])/gu;

export function configureMarkdownFormat(ctx: Ctx) {
  ctx.update(remarkStringifyOptionsCtx, (options) => {
    const text = options.handlers?.text;
    return {
      ...options,
      bullet: "-" as const,
      rule: "-" as const,
      join: [...(options.join ?? []), joinListChildren],
      handlers: {
        ...options.handlers,
        ...(text
          ? {
              text: (...args: Parameters<typeof text>) =>
                text(...args).replace(INTRAWORD_UNDERSCORE_ESCAPE, "_"),
            }
          : {}),
      },
    };
  });
}
