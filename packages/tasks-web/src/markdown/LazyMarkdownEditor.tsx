import { lazy, Suspense, useEffect, type ComponentType } from "react";

import { RenderErrorBoundary } from "../../../../apps/web/src/components/RenderErrorBoundary.tsx";
import { cn } from "../../../../apps/web/src/lib/utils.ts";
import type { MarkdownEditorProps } from "./MarkdownEditor.tsx";

let resolvedEditor: ComponentType<MarkdownEditorProps> | null = null;
let markdownEditorLoad: Promise<typeof import("./MarkdownEditor.tsx")> | null = null;

function loadMarkdownEditor() {
  markdownEditorLoad ??= import("./MarkdownEditor.tsx").then(
    (module) => {
      resolvedEditor = module.default;
      return module;
    },
    (error) => {
      markdownEditorLoad = null;
      throw error;
    },
  );
  return markdownEditorLoad;
}

// Milkdown loads with the first editor on screen (a task window, a table
// detail or a settings page), never with the app, the chat or a list.
const MarkdownEditor = lazy(loadMarkdownEditor);

export function preloadMarkdownEditor() {
  void loadMarkdownEditor().catch(() => undefined);
}

function MarkdownEditorFallback(props: MarkdownEditorProps) {
  const { onReady } = props;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- signals ready on chunk-load error so an accordion does not stay gated
  useEffect(() => {
    onReady?.();
  }, [onReady]);
  return (
    <textarea
      value={props.value}
      disabled={props.disabled}
      placeholder={props.placeholder}
      aria-label={props.ariaLabel}
      className={cn(
        "markdown-editor field-sizing-content resize-none bg-transparent outline-none",
        props.className,
      )}
      onChange={(event) => props.onChange(event.currentTarget.value)}
      onBlur={props.onBlur}
    />
  );
}

export function LazyMarkdownEditor(props: MarkdownEditorProps) {
  const Editor = resolvedEditor ?? MarkdownEditor;
  return (
    <RenderErrorBoundary fallback={<MarkdownEditorFallback {...props} />}>
      <Suspense fallback={<div className={cn("markdown-editor", props.className)} />}>
        <Editor {...props} />
      </Suspense>
    </RenderErrorBoundary>
  );
}
