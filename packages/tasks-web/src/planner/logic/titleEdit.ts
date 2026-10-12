export type TitleEditResult =
  | { readonly kind: "empty" }
  | { readonly kind: "unchanged" }
  | { readonly kind: "save"; readonly title: string };

/** What saving an inline title edit does: refuse an empty title, skip an unchanged one. */
export function titleEditResult(draft: string, original: string): TitleEditResult {
  const title = draft.trim();
  if (!title) return { kind: "empty" };
  if (title === original) return { kind: "unchanged" };
  return { kind: "save", title };
}
