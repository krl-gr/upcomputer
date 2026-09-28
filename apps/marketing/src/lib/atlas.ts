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

export type ViewMode = "all" | "differs" | "mapped" | "gaps";

export interface ViewState {
  selected: string[];
  open: Set<string>;
  query: string;
  mode: ViewMode;
}

export const DEFAULT_PRODUCTS = ["claude-code-cli", "codex-cli", "pi-cli", "hermes-agent"];
export const DEFAULT_OPEN = [
  "interaction",
  "interaction-input",
  "interaction-suggestions",
  "interaction-running",
  "interaction-queues",
  "interaction-side",
  "interaction-background",
  "interaction-terminal",
];
const VIEW_MODES: ViewMode[] = ["all", "differs", "mapped", "gaps"];
// Older shared links used finer-grained gap filters; both now mean "missing somewhere".
const LEGACY_MODES: Record<string, ViewMode> = { unmapped: "gaps", unresolved: "gaps" };
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

export function readViewState(
  search: string,
  products: AtlasProduct[],
  nodes: AtlasNode[],
): ViewState {
  const params = new URLSearchParams(search);
  const allowed = new Set(products.map((p) => p.id));
  const groups = new Set(nodes.filter((n) => n.kind === "group").map((n) => n.id));
  let selected = [
    ...new Set(
      (params.get("products") ?? DEFAULT_PRODUCTS.join(","))
        .split(",")
        .filter((id) => allowed.has(id)),
    ),
  ];
  if (!selected.length) selected = DEFAULT_PRODUCTS.filter((id) => allowed.has(id));
  const open = new Set(
    (params.get("open") ?? DEFAULT_OPEN.join(",")).split(",").filter((id) => groups.has(id)),
  );
  const rawMode = params.get("view") ?? "all";
  const mode = LEGACY_MODES[rawMode] ?? rawMode;
  return {
    selected,
    open,
    query: params.get("q") ?? "",
    mode: VIEW_MODES.includes(mode as ViewMode) ? (mode as ViewMode) : "all",
  };
}

export function viewSearch(state: ViewState): string {
  const params = new URLSearchParams();
  params.set("products", state.selected.join(","));
  params.set("open", [...state.open].join(","));
  if (state.query) params.set("q", state.query);
  if (state.mode !== "all") params.set("view", state.mode);
  return `?${params.toString()}`;
}

export function visibleTree(flat: FlatNode[], cells: AtlasCell[], state: ViewState) {
  const index = new Map(cells.map((c) => [cellKey(c.capability_id, c.product_id), c]));
  const labels = new Map(flat.map((n) => [n.id, n.label]));
  const tokens = state.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = new Set<string>();
  for (const node of flat) {
    if (node.kind !== "capability") continue;
    const nodeCells = state.selected
      .map((p) => index.get(cellKey(node.id, p)))
      .filter((c): c is AtlasCell => c !== undefined);
    const text = [
      node.label,
      node.summary ?? "",
      ...node.ancestors.map((a) => labels.get(a) ?? ""),
      ...nodeCells.flatMap((c) => c.names),
    ]
      .join(" ")
      .toLocaleLowerCase();
    const found = nodeCells.filter((c) => c.status === "documented").length;
    const missing = state.selected.length - found;
    const modeMatches =
      state.mode === "all" ||
      (state.mode === "mapped" && found > 0) ||
      (state.mode === "gaps" && missing > 0) ||
      (state.mode === "differs" && found > 0 && missing > 0);
    if (modeMatches && tokens.every((t) => text.includes(t))) matches.add(node.id);
  }
  const filtering = tokens.length > 0 || state.mode !== "all";
  const visible = new Set<string>();
  for (const node of flat) {
    if (filtering) {
      if (!matches.has(node.id)) continue;
      visible.add(node.id);
      node.ancestors.forEach((id) => visible.add(id));
    } else if (node.ancestors.every((id) => state.open.has(id))) {
      visible.add(node.id);
    }
  }
  return { visible, matches, filtering };
}

/** Clears filters and opens the path to a row, for `#cap-…` links. */
export function revealNode(state: ViewState, flat: FlatNode[], id: string): boolean {
  const node = flat.find((n) => n.id === id);
  if (!node) return false;
  state.query = "";
  state.mode = "all";
  node.ancestors.forEach((a) => state.open.add(a));
  if (node.kind === "group") state.open.add(node.id);
  return true;
}
