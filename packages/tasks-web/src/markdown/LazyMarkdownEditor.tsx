import { lazy, Suspense } from "react";

import { cn } from "../../../../apps/web/src/lib/utils.ts";
import type { MarkdownEditorProps } from "./MarkdownEditor.tsx";

const loadMarkdownEditor = () => import("./MarkdownEditor.tsx");

// Milkdown loads with the first editor on screen (a task window, a table
// detail or a settings page), never with the app, the chat or a list.
const MarkdownEditor = lazy(loadMarkdownEditor);

export function preloadMarkdownEditor() {
  void loadMarkdownEditor();
}

export function LazyMarkdownEditor(props: MarkdownEditorProps) {
  return (
    <Suspense fallback={<div className={cn("markdown-editor", props.className)} />}>
      <MarkdownEditor {...props} />
    </Suspense>
  );
}
