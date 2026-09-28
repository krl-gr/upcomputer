import {
  DEFAULT_PRODUCTS,
  cellKey,
  flattenTree,
  readViewState,
  revealNode,
  surfaceTag,
  viewSearch,
  visibleTree,
  type AtlasData,
} from "../lib/atlas";

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const data = JSON.parse(byId("atlas-data").textContent ?? "{}") as AtlasData;
const flat = flattenTree(data.nodes);
const nodes = new Map(flat.map((n) => [n.id, n]));
const cells = new Map(data.cells.map((c) => [cellKey(c.capability_id, c.product_id), c]));
const products = new Map(data.products.map((p) => [p.id, p]));
let state = readViewState(location.search, data.products, data.nodes);

const query = byId<HTMLInputElement>("tree-query");
const mode = byId<HTMLSelectElement>("tree-view");
const checkboxes = [
  ...document.querySelectorAll<HTMLInputElement>('input[name="compare-product"]'),
];
const rows = [...document.querySelectorAll<HTMLElement>("[data-node]")];
const columns = [...document.querySelectorAll<HTMLElement>("[data-product-column]")];
const groupFills = [...document.querySelectorAll<HTMLTableCellElement>(".group-fill")];
const toggles = [...document.querySelectorAll<HTMLButtonElement>("[data-toggle]")];
const result = byId("tree-result");
const dialog = byId<HTMLDialogElement>("cell-dialog");
const picker = document.querySelector<HTMLDetailsElement>(".product-picker")!;

function render(writeUrl = true) {
  const view = visibleTree(flat, data.cells, state);
  const selected = new Set(state.selected);
  query.value = state.query;
  mode.value = state.mode;
  checkboxes.forEach((input) => {
    input.checked = selected.has(input.value);
  });
  columns.forEach((el) => {
    el.hidden = !selected.has(el.dataset.productColumn ?? "");
  });
  groupFills.forEach((el) => {
    el.colSpan = state.selected.length;
  });
  rows.forEach((el) => {
    el.hidden = !view.visible.has(el.dataset.node ?? "");
  });
  toggles.forEach((button) => {
    button.setAttribute(
      "aria-expanded",
      String(view.filtering || state.open.has(button.dataset.toggle ?? "")),
    );
    button.disabled = view.filtering;
    button.title = view.filtering ? "Clear the search to collapse sections." : "";
  });
  byId("selected-count").textContent = String(state.selected.length);
  const shownFeatures = flat.filter(
    (n) => n.kind === "capability" && view.visible.has(n.id),
  ).length;
  result.textContent = `${state.selected.length} tools · ${shownFeatures} features shown${
    view.filtering ? ` · ${view.matches.size} matches` : ""
  }`;
  byId("tree-empty").hidden = !view.filtering || view.matches.size > 0;
  byId("reset-search").hidden = !view.filtering;
  if (writeUrl)
    history.replaceState(null, "", location.pathname + viewSearch(state) + location.hash);
}

function resetSearch() {
  state.query = "";
  state.mode = "all";
  render();
}

query.addEventListener("input", () => {
  state.query = query.value;
  render();
});
mode.addEventListener("change", () => {
  state.mode = mode.value as typeof state.mode;
  render();
});
for (const checkbox of checkboxes) {
  checkbox.addEventListener("change", () => {
    const selected = checkboxes.filter((c) => c.checked).map((c) => c.value);
    if (!selected.length) {
      checkbox.checked = true;
      result.textContent = "Keep at least one tool selected.";
      return;
    }
    state.selected = selected;
    render();
  });
}
for (const toggle of toggles) {
  toggle.addEventListener("click", () => {
    const id = toggle.dataset.toggle ?? "";
    if (state.open.has(id)) state.open.delete(id);
    else state.open.add(id);
    render();
  });
}
byId("reset-search").addEventListener("click", resetSearch);
byId("empty-reset").addEventListener("click", resetSearch);
byId("expand-tree").addEventListener("click", () => {
  state.open = new Set(flat.filter((n) => n.kind === "group").map((n) => n.id));
  resetSearch();
});
byId("collapse-tree").addEventListener("click", () => {
  state.open.clear();
  resetSearch();
});
byId("select-inventories").addEventListener("click", () => {
  state.selected = data.products.map((p) => p.id);
  render();
});
byId("reset-products").addEventListener("click", () => {
  state.selected = [...DEFAULT_PRODUCTS];
  render();
});
document.addEventListener("click", (event) => {
  if (!picker.contains(event.target as Node)) picker.open = false;
});
picker.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  picker.open = false;
  picker.querySelector("summary")?.focus();
  event.stopPropagation();
});

// Details are built from text nodes only: documentation quotes and URLs are never rendered as HTML.
function element(tag: string, text?: string, className?: string) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function link(text: string, url: string) {
  const a = element("a", text) as HTMLAnchorElement;
  const parsed = new URL(url, location.href);
  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  }
  return a;
}

// Notes mark commands and keys with backticks; render those as code.
function richText(text: string, className: string) {
  const node = element("p", undefined, className);
  text.split("`").forEach((part, index) => {
    if (part) node.append(index % 2 ? element("code", part) : part);
  });
  return node;
}

function openCell(key: string) {
  const cell = cells.get(key);
  if (!cell) return;
  const node = nodes.get(cell.capability_id)!;
  const product = products.get(cell.product_id)!;
  byId("cell-title").textContent = node.label;
  byId("cell-product").textContent = product.name;
  byId("cell-path").textContent = node.ancestors.map((id) => nodes.get(id)?.label).join(" / ");
  const content = byId("cell-content");
  content.replaceChildren();
  if (node.summary) content.append(element("p", node.summary));
  if (cell.status === "unresolved") {
    content.append(
      element(
        "p",
        `The ${product.name} docs describe something close, but don’t confirm this feature.`,
      ),
    );
  } else if (cell.status === "not_found") {
    content.append(
      element(
        "p",
        `Not found in the ${product.name} docs${cell.checked_at ? ` (checked ${cell.checked_at})` : ""}.`,
      ),
    );
  } else {
    const how = element("div", undefined, "cell-how");
    cell.names.forEach((name) => how.append(element("code", name)));
    content.append(how);
  }
  const tag = surfaceTag(cell);
  if (tag) content.append(element("p", `Works via: ${tag}`));
  if (cell.note) content.append(richText(cell.note, "cell-note"));
  if (cell.freshness === "stale" || cell.freshness === "superseded") {
    content.append(
      element(
        "p",
        cell.freshness === "stale"
          ? "Checked a while ago, may be outdated."
          : "The docs changed since this was checked; this entry needs an update.",
        "cell-warning",
      ),
    );
  }

  const quotes = cell.quotes.map((id) => data.quotes[id]).filter((q) => q !== undefined);
  const sources = cell.sources.map((id) => data.sources[id]).filter((s) => s !== undefined);
  if (quotes.length || sources.length) {
    content.append(element("h3", "Sources"));
    const list = element("ul");
    const seen = new Set<string>();
    for (const q of quotes) {
      if (seen.has(q.url)) continue;
      seen.add(q.url);
      const item = element("li");
      item.append(link(q.title, q.url), element("blockquote", q.quote));
      list.append(item);
    }
    for (const s of sources) {
      if (seen.has(s.url)) continue;
      seen.add(s.url);
      const item = element("li");
      item.append(link(s.title, s.url));
      list.append(item);
    }
    content.append(list);
    if (cell.checked_at)
      content.append(element("p", `Official docs, checked ${cell.checked_at}`, "record-dates"));
  }
  if (!dialog.open) dialog.showModal();
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-cell]")) {
  button.addEventListener("click", () => openCell(button.dataset.cell ?? ""));
}
// Close on a click outside the dialog box (on the backdrop).
dialog.addEventListener("click", (event) => {
  const rect = dialog.getBoundingClientRect();
  const outside =
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom;
  if (event.target === dialog && outside) dialog.close();
});

function revealHash() {
  let hash: string;
  try {
    hash = decodeURIComponent(location.hash.slice(1));
  } catch {
    return;
  }
  if (!hash.startsWith("cap-") || !revealNode(state, flat, hash.slice(4))) return;
  render();
  requestAnimationFrame(() =>
    document.getElementById(hash)?.scrollIntoView({ block: "nearest", inline: "nearest" }),
  );
}

window.addEventListener("hashchange", revealHash);
window.addEventListener("popstate", () => {
  state = readViewState(location.search, data.products, data.nodes);
  render(false);
  revealHash();
});
render(false);
revealHash();
