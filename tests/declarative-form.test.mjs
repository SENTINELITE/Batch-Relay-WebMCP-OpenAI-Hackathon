import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  describeFormatMatches,
  filterFormats,
  matchesFormatQuery,
  normalizeFormatText,
} from "../src/lib/storefront/format-search.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const PRODUCTS = [
  { id: "print-5x7", revision: 3, name: "5x7 Print", physical_output: { width: 5, height: 7, unit: "inches" } },
  { id: "print-8x10", revision: 4, name: "8x10 Print", physical_output: { width: 8, height: 10, unit: "inches" } },
  { id: "memory-mate-8x10", revision: 2, name: "Memory Mate 8x10", physical_output: { width: 8, height: 10, unit: "inches" } },
  { id: "print-4x6", revision: 1, name: "4x6 Print", physical_output: { width: 4, height: 6, unit: "inches" } },
];

test("a shopper's phrasing of a size finds the format", () => {
  // "8 by 10", "8 x 10" and "8×10" are the same request.
  for (const query of ["8 by 10", "8 x 10", "8×10", "8x10"]) {
    const ids = filterFormats(PRODUCTS, query).map((product) => product.id);
    assert.deepEqual(ids, ["print-8x10", "memory-mate-8x10"], `query: ${query}`);
  }
});

test("a product name matches across the id's hyphens", () => {
  const ids = filterFormats(PRODUCTS, "memory mate").map((product) => product.id);
  assert.deepEqual(ids, ["memory-mate-8x10"]);
});

test("an empty query leaves the grid untouched", () => {
  assert.equal(filterFormats(PRODUCTS, ""), PRODUCTS);
  assert.equal(filterFormats(PRODUCTS, "   "), PRODUCTS);
  assert.ok(matchesFormatQuery(PRODUCTS[0], ""));
});

test("a query that matches nothing filters everything out", () => {
  assert.deepEqual(filterFormats(PRODUCTS, "canvas wrap"), []);
});

test("normalization folds separators without merging distinct tokens", () => {
  assert.equal(normalizeFormatText("Memory-Mate 8 by 10"), "memory mate 8x10");
  assert.equal(normalizeFormatText("  5 × 7  "), "5x7");
});

test("the agent's text result names the matches, and says so when there are none", () => {
  const hit = describeFormatMatches(PRODUCTS, "8 by 10");
  assert.match(hit, /8x10 Print \(print-8x10, 8 × 10\)/);
  assert.match(hit, /Memory Mate 8x10 \(memory-mate-8x10, 8 × 10\)/);
  assert.doesNotMatch(hit, /4x6/);

  const miss = describeFormatMatches(PRODUCTS, "canvas wrap");
  assert.match(miss, /No print format in the visible chooser matches "canvas wrap"/);

  assert.match(describeFormatMatches([], "8x10"), /no print formats loaded/i);
});

test("the search form is a declarative WebMCP tool", async () => {
  const source = await read("src/components/storefront/format-picker.tsx");

  assert.match(source, /toolname: "search-print-formats"/);
  assert.match(source, /tooldescription:/);
  assert.match(source, /toolautosubmit: ""/);
  assert.match(source, /toolparamtitle: "Print format query"/);
  assert.match(source, /toolparamdescription:/);

  // The declarative name must not collide with the imperative SDK tool.
  assert.doesNotMatch(source, /find_prints/);

  // The attribute bags have to actually reach the form and its input.
  assert.match(source, /<form\s+\{\.\.\.searchFormToolAttributes\}/);
  assert.match(source, /\{\.\.\.searchInputToolAttributes\}/);
  assert.match(source, /name="query"/);
});

test("the submit handler feature-detects instead of assuming WebMCP", async () => {
  const source = await read("src/components/storefront/format-picker.tsx");

  assert.match(source, /"respondWith" in agentEvent/);
  assert.match(source, /typeof agentEvent\.respondWith === "function"/);
  assert.match(source, /agentEvent\.agentInvoked === true/);
  assert.match(source, /event\.preventDefault\(\)/);

  // The human path runs unconditionally, before any agent branch.
  const humanIndex = source.indexOf("setQuery(value)");
  const agentIndex = source.indexOf('"respondWith" in agentEvent');
  assert.ok(humanIndex > 0 && humanIndex < agentIndex);

  // Both paths read the same filter, so the grid and the agent can't disagree.
  assert.match(source, /describeFormatMatches\(products, value\)/);
  assert.match(source, /filterFormats\(products, query\)/);
});

test("the declarative tool description scopes itself to the visible chooser", async () => {
  const source = await read("src/components/storefront/format-picker.tsx");
  assert.match(
    source,
    /"Search the live print formats shown in the catalog chooser by size or name\./,
  );
});

test("the demo hides, rather than removes, its secondary catalog controls", async () => {
  const source = await read("src/components/storefront/format-picker.tsx");

  assert.match(source, /className="mt-6 hidden flex-col[\s\S]*?ref=\{formRef\}/);
  assert.match(source, /<details className="group hidden rounded-\[22px\][\s\S]*?Explore more print formats/);
  assert.match(source, /toolname: "search-print-formats"/);
});
