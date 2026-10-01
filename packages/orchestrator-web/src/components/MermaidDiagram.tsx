import { useEffect, useId, useMemo, useState } from "react";

import { useTheme } from "../../../../apps/web/src/hooks/useTheme.ts";

type ResolvedTheme = "light" | "dark";

function themeVariables(theme: ResolvedTheme) {
  if (theme === "dark") {
    return {
      background: "transparent",
      mainBkg: "#1f1f1f",
      primaryColor: "#1f1f1f",
      primaryTextColor: "#f5f5f5",
      primaryBorderColor: "#52525b",
      secondaryColor: "#27272a",
      tertiaryColor: "#18181b",
      lineColor: "#a1a1aa",
      textColor: "#f5f5f5",
      nodeBorder: "#52525b",
      clusterBkg: "#18181b",
      clusterBorder: "#3f3f46",
      edgeLabelBackground: "#1f1f1f",
      titleColor: "#f5f5f5",
    };
  }
  return {
    background: "transparent",
    mainBkg: "#ffffff",
    primaryColor: "#ffffff",
    primaryTextColor: "#27272a",
    primaryBorderColor: "#d4d4d8",
    secondaryColor: "#fafafa",
    tertiaryColor: "#f4f4f5",
    lineColor: "#71717a",
    textColor: "#27272a",
    nodeBorder: "#d4d4d8",
    clusterBkg: "#fafafa",
    clusterBorder: "#d4d4d8",
    edgeLabelBackground: "#ffffff",
    titleColor: "#27272a",
  };
}

function themeCss(theme: ResolvedTheme): string {
  const nodeFill = theme === "dark" ? "#1f1f1f" : "#ffffff";
  const nodeStroke = theme === "dark" ? "#52525b" : "#d4d4d8";
  const text = theme === "dark" ? "#f5f5f5" : "#27272a";
  const line = theme === "dark" ? "#a1a1aa" : "#71717a";
  return `
    .node rect, .node polygon, .node circle, .node ellipse, .node path {
      fill: ${nodeFill} !important; stroke: ${nodeStroke} !important;
    }
    .nodeLabel, .nodeLabel p, .label, .label text, .edgeLabel,
    .edgeLabel p, .cluster-label text, text {
      color: ${text} !important; fill: ${text} !important;
    }
    .flowchart-link, .edgePath .path, .edge-pattern-solid {
      stroke: ${line} !important;
    }
    .arrowheadPath, marker path { fill: ${line} !important; stroke: ${line} !important; }
    .edgeLabel, .edgeLabel p { background-color: ${nodeFill} !important; }
  `;
}

/** Strict Mermaid renderer with a source fallback when rendering fails. */
export function MermaidDiagram({ source }: { readonly source: string }) {
  const { resolvedTheme } = useTheme();
  const rawId = useId();
  const diagramId = useMemo(
    () => `orchestrator-mermaid-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}-${resolvedTheme}`,
    [rawId, resolvedTheme],
  );
  const diagramSource = source.trim();
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!diagramSource) {
      setSvg(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setSvg(null);
    setError(null);
    void import("mermaid")
      .then(({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          themeCSS: themeCss(resolvedTheme),
          themeVariables: themeVariables(resolvedTheme),
        });
        return mermaid.render(diagramId, diagramSource);
      })
      .then(({ svg: rendered }) => {
        if (!cancelled) setSvg(rendered);
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Could not render diagram.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [diagramId, diagramSource, resolvedTheme]);

  if (error) {
    return (
      <div className="rounded-lg border border-border/50 bg-card p-3 dark:bg-muted/35">
        <p className="mb-2 text-sm text-destructive-foreground">{error}</p>
        <pre className="overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
          {diagramSource}
        </pre>
      </div>
    );
  }
  if (!svg) {
    return (
      <div className="rounded-lg border border-border/50 bg-card px-3 py-2 text-sm text-muted-foreground dark:bg-muted/35">
        Rendering diagram...
      </div>
    );
  }
  return (
    <div className="overflow-auto rounded-lg border border-border/50 bg-card p-3 dark:bg-muted/20">
      <div
        className="min-w-fit [&_svg]:h-auto [&_svg]:max-w-full"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}
