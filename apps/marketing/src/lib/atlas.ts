// CLI Atlas view model, shared by the page (build time) and its script
// (browser). The dataset is exported from the Atlas research repository by
// `scripts/export-site-data.mjs`; see `src/data/atlas.json`.

export interface AtlasNode {
  id: string;
  parent: string | null;
  label: string;
  kind: "group" | "capability";
  summary?: string;
}

export interface AtlasCell {
  capability_id: string;
  product_id: string;
  status: "documented" | "unresolved" | "not_found";
  names: string[];
  route: string;
  surface: string;
  note?: string;
  freshness: "current" | "stale" | "superseded" | "unknown";
  checked_at?: string;
  /** Sources searched beyond the docs: release notes, source code of the latest release. */
  checked_sources?: ("release_notes" | "source_code")[];
  sources: string[];
  quotes: string[];
}

export interface AtlasProduct {
  id: string;
  name: string;
  feature_count: number;
}

export interface AtlasData {
  schema_version: 1;
  built_at: string;
  revision: string;
  products: AtlasProduct[];
  nodes: AtlasNode[];
  cells: AtlasCell[];
  sources: Record<string, { title: string; url: string }>;
  quotes: Record<string, { title: string; url: string; quote: string; acquired_at: string | null }>;
}

export interface FlatNode extends AtlasNode {
  ancestors: string[];
  depth: number;
}

/** Logo per tool; tools without one get a monogram. */
export const TOOL_ICONS: Record<string, string> = {
  "codex-cli": "/harnesses/openai_dark.svg",
  "claude-code-cli": "/harnesses/claude-ai-icon.svg",
  "cursor-cli": "/harnesses/cursor_light.svg",
  "opencode-cli": "/harnesses/opencode-dark.svg",
  "pi-cli": "/harnesses/pi.svg",
};

const SEARCHED = { release_notes: "release notes", source_code: "source code" } as const;

/** What was searched for a cell, as a reader phrase: "docs", "docs or release notes", ... */
export function searched(cell: Pick<AtlasCell, "checked_sources">, joiner = "or"): string {
  const parts = ["docs", ...(cell.checked_sources ?? []).map((s) => SEARCHED[s])];
  return parts.length === 1
    ? parts[0]!
    : `${parts.slice(0, -1).join(", ")} ${joiner} ${parts.at(-1)}`;
}

export function statusHint(cell: Pick<AtlasCell, "status" | "checked_sources">): string {
  if (cell.status === "documented") return "Confirmed. Click for how it works.";
  if (cell.status === "unresolved") return "Something close exists, but not this exact feature.";
  return `Not in the ${searched(cell)}.`;
}

/** Kind of official page behind a quote, from its URL. */
export function evidenceKind(url: string): "Docs" | "Release notes" | "Source code" {
  if (/raw\.githubusercontent\.com/.test(url)) return "Source code";
  if (/\/releases\/tag\/|\/changelog(\/|$)|CHANGELOG\.md/i.test(url)) return "Release notes";
  return "Docs";
}

const ROUTE_NAMES: Record<string, string> = {
  cli: "CLI",
  extension: "Extension",
  mcp: "MCP server",
  external_runtime: "External runtime",
  sdk: "SDK",
  hosted: "Hosted service",
  unspecified: "CLI",
};

export const cellKey = (capabilityId: string, productId: string) => `${capabilityId}/${productId}`;

/** Short tag shown when a feature is not reached through the CLI itself. */
export function surfaceTag(cell: AtlasCell): string | null {
  if (cell.route !== "unspecified" && cell.route !== "cli")
    return ROUTE_NAMES[cell.route] ?? cell.route;
  return ["CLI", "Interactive CLI"].includes(cell.surface) ? null : cell.surface;
}

export function flattenTree(nodes: AtlasNode[]): FlatNode[] {
  const children = new Map<string | null, AtlasNode[]>();
  for (const node of nodes) {
    const siblings = children.get(node.parent) ?? [];
    siblings.push(node);
    children.set(node.parent, siblings);
  }
  const result: FlatNode[] = [];
  const visit = (parent: string | null, ancestors: string[]) => {
    for (const node of children.get(parent) ?? []) {
      result.push({ ...node, ancestors, depth: ancestors.length });
      visit(node.id, [...ancestors, node.id]);
    }
  };
  visit(null, []);
  return result;
}

/** Tools picked with the chips; an empty selection shows every tool. */
export function readSelectedTools(search: string, products: AtlasProduct[]): string[] {
  const allowed = new Set(products.map((p) => p.id));
  const raw = new URLSearchParams(search).get("tools") ?? "";
  return [...new Set(raw.split(",").filter((id) => allowed.has(id)))];
}

export function toolsSearch(selected: string[]): string {
  return selected.length ? `?tools=${selected.join(",")}` : "";
}
