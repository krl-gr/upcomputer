import {
  cellKey,
  evidenceKind,
  flattenTree,
  readSelectedTools,
  searched,
  surfaceTag,
  toolsSearch,
  type AtlasData,
} from "../lib/atlas";

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const data = JSON.parse(byId("atlas-data").textContent ?? "{}") as AtlasData;
const nodes = new Map(flattenTree(data.nodes).map((n) => [n.id, n]));
const cells = new Map(data.cells.map((c) => [cellKey(c.capability_id, c.product_id), c]));
const products = new Map(data.products.map((p) => [p.id, p]));
const chips = [...document.querySelectorAll<HTMLButtonElement>("[data-tool]")];
const columns = [...document.querySelectorAll<HTMLElement>("[data-product-column]")];
const groupCells = [...document.querySelectorAll<HTMLTableCellElement>("[data-group-cell]")];
const dialog = byId<HTMLDialogElement>("cell-dialog");

let selected = readSelectedTools(location.search, data.products);

function render(writeUrl = true) {
  const shown = new Set(selected.length ? selected : data.products.map((p) => p.id));
  chips.forEach((chip) =>
    chip.setAttribute("aria-pressed", String(selected.includes(chip.dataset.tool ?? ""))),
  );
  columns.forEach((el) => {
    el.hidden = !shown.has(el.dataset.productColumn ?? "");
  });
  groupCells.forEach((el) => {
    el.colSpan = shown.size + 1;
  });
  if (writeUrl)
    history.replaceState(null, "", location.pathname + toolsSearch(selected) + location.hash);
}

// No chip pressed means every tool; pressing chips narrows the table to them.
for (const chip of chips) {
  chip.addEventListener("click", () => {
    const id = chip.dataset.tool ?? "";
    selected = selected.includes(id) ? selected.filter((t) => t !== id) : [...selected, id];
    render();
  });
}

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
        `The ${product.name} ${searched(cell, "and")} describe something close, but don’t confirm this feature.`,
      ),
    );
  } else if (cell.status === "not_found") {
    content.append(
      element(
        "p",
        `Not found in the ${product.name} ${searched(cell)}${cell.checked_at ? ` (checked ${cell.checked_at})` : ""}.`,
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
      item.append(
        element("span", evidenceKind(q.url), "source-kind"),
        link(q.title, q.url),
        element("blockquote", q.quote),
      );
      list.append(item);
    }
    for (const s of sources) {
      if (seen.has(s.url)) continue;
      seen.add(s.url);
      const item = element("li");
      item.append(element("span", evidenceKind(s.url), "source-kind"), link(s.title, s.url));
      list.append(item);
    }
    content.append(list);
    if (cell.checked_at)
      content.append(element("p", `Official sources, checked ${cell.checked_at}`, "record-dates"));
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

window.addEventListener("popstate", () => {
  selected = readSelectedTools(location.search, data.products);
  render(false);
});
render(false);
