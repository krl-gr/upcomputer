import { remarkStringifyOptionsCtx } from "@milkdown/core";
import type { Ctx } from "@milkdown/ctx";
import { commonmark, linkSchema, remarkPreserveEmptyLinePlugin } from "@milkdown/preset-commonmark";
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

// Schemes a link may navigate to. A link without a scheme is relative or an
// anchor and stays in the app.
const SAFE_LINK_SCHEMES = new Set(["http", "https", "mailto"]);
// oxlint-disable-next-line no-control-regex -- browsers strip these around a URL
const SURROUNDING_URL_CONTROLS = /^[\u0000-\u0020]+|[\u0000-\u0020]+$/g;

/**
 * The href a link may keep, or null for one that would run code (`javascript:`,
 * `data:`, `vbscript:`). Browsers drop tabs and newlines inside a URL and
 * control characters and spaces around it before reading the scheme, so the
 * scheme is read the same way.
 */
export function safeLinkHref(href: unknown): string | null {
  if (typeof href !== "string") return null;
  const normalized = href.replace(/[\t\n\r]/g, "").replace(SURROUNDING_URL_CONTROLS, "");
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(normalized)?.[1];
  return scheme === undefined || SAFE_LINK_SCHEMES.has(scheme.toLowerCase()) ? href : null;
}

/**
 * Agents and pasted text can carry `[text](javascript:...)`. Such a link loads
 * as plain text, and no `<a>` the editor renders carries an unsafe href, in
 * either the editable or the read-only state.
 */
function configureSafeLinks(ctx: Ctx) {
  ctx.update(linkSchema.key, (base) => (schemaCtx) => {
    const schema = base(schemaCtx);
    return {
      ...schema,
      parseDOM: [
        {
          tag: "a[href]",
          getAttrs: (dom) => {
            if (!(dom instanceof HTMLElement)) return false;
            const href = safeLinkHref(dom.getAttribute("href"));
            return href === null ? false : { href, title: dom.getAttribute("title") };
          },
        },
      ],
      toDOM: (mark, inline) => {
        const href = safeLinkHref(mark.attrs.href);
        const [, attrs] = schema.toDOM!(mark, inline) as [string, Record<string, unknown>];
        return ["a", { ...attrs, href: href ?? undefined }];
      },
      parseMarkdown: {
        match: schema.parseMarkdown.match,
        runner: (state, node, markType) => {
          if (safeLinkHref(node.url) === null) {
            state.next(node.children);
            return;
          }
          schema.parseMarkdown.runner(state, node, markType);
        },
      },
    };
  });
}

export function configureMarkdownFormat(ctx: Ctx) {
  configureSafeLinks(ctx);
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
