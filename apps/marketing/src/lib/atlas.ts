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

export const STATUS_HINTS = {
  documented: "In the docs. Click for how it works.",
  unresolved: "Something close is documented, but not this exact feature.",
  not_found: "Not in the docs.",
} as const;

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
