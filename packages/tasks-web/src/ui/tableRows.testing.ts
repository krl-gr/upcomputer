import * as NodeAssert from "node:assert/strict";

const OTHER_TEXT_SIZE =
  /(^|\s)([a-z-]+:)*text-(xs|2xs|3xs|4xs|5xs|base|lg|xl|\d?xl|\[[^\]]*\])(\s|$)/;

/**
 * Asserts the rule of the Tasks, Agents and Automations tables on rendered
 * markup: rows and headers use the table's `text-sm` only, every row cell is
 * centred vertically, and every pill is the shared `TablePill` at `text-sm`.
 */
export function assertTableRowsOneSize(html: string) {
  NodeAssert.match(html, /<table[^>]*class="[^"]*\btext-sm\b/, "the table sets text-sm");
  const table = html.slice(html.indexOf("<table"), html.indexOf("</table>"));
  NodeAssert.ok(table.length > 0, "a table is rendered");
  for (const [, className] of table.matchAll(/class="([^"]*)"/g)) {
    NodeAssert.doesNotMatch(className!, OTHER_TEXT_SIZE, `one text size: "${className}"`);
  }
  const cells = [...table.matchAll(/<td[^>]*class="([^"]*)"/g)].map((match) => match[1]!);
  NodeAssert.ok(cells.length > 0, "rows have cells");
  for (const className of cells) {
    NodeAssert.match(className, /(^|\s)align-middle(\s|$)/, `centred cell: "${className}"`);
  }
  for (const [, className] of table.matchAll(/class="([^"]*)" data-table-pill=/g)) {
    NodeAssert.match(className!, /(^|\s)text-sm(\s|$)/, `pill at text-sm: "${className}"`);
  }
}
