// @effect-diagnostics nodeBuiltinImport:off - reads the catalogs gt writes, as the app loads them.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "./locales";

type Entry = string | ReadonlyArray<unknown>;
type Catalog = Readonly<Record<string, Entry>>;

const directory = NodePath.join(import.meta.dirname, "translations");
const readCatalog = (locale: string): Catalog =>
  JSON.parse(NodeFS.readFileSync(NodePath.join(directory, `${locale}.json`), "utf8"));

/** ICU argument names in a string entry, or `<T>` variable keys in a JSX entry. */
function variables(entry: Entry): ReadonlyArray<string> {
  if (typeof entry === "string") {
    return [
      ...new Set([...entry.matchAll(/\{\s*([\w$]+)\s*[,}]/g)].map((match) => match[1]!)),
    ].toSorted();
  }
  return [...JSON.stringify(entry).matchAll(/"k":"([^"]+)"/g)].map((match) => match[1]!).toSorted();
}

const source = readCatalog(DEFAULT_LOCALE);
const translated = SUPPORTED_LOCALES.filter((locale) => locale !== DEFAULT_LOCALE);

describe("translation catalogs", () => {
  it.each(translated)("%s has every English key and no others", (locale) => {
    expect(Object.keys(readCatalog(locale)).toSorted()).toEqual(Object.keys(source).toSorted());
  });

  it.each(translated)("%s keeps each entry's variables", (locale) => {
    const catalog = readCatalog(locale);
    const mismatched = Object.keys(source).filter(
      (key) =>
        catalog[key] !== undefined &&
        variables(catalog[key]).join() !== variables(source[key]!).join(),
    );
    expect(mismatched).toEqual([]);
  });

  it.each(SUPPORTED_LOCALES)("%s has no em dashes", (locale) => {
    const withDash = Object.entries(readCatalog(locale))
      .filter(([, entry]) => JSON.stringify(entry).includes("—"))
      .map(([key]) => key);
    expect(withDash).toEqual([]);
  });
});
