import assert from "node:assert/strict";
import test from "node:test";

import {
  compatibleOutputVariantSummary,
  compatibleTemplateOutputs,
  visibleStorefrontProducts,
} from "../src/lib/storefront/template-compatibility.ts";

const product = { id: "memory-mate-8x10", revision: 7 };

test("keeps every exact canonical Memory Mate output selectable, including portrait and landscape", () => {
  const outputs = [
    { id: "memory-mate-portrait", ordinal: 1, products: [{ canonical_product_id: "memory-mate-8x10", canonical_product_revision: 7, width_in: 8, height_in: 10, orientation: "portrait" }] },
    { id: "memory-mate-landscape", ordinal: 2, products: [{ canonical_product_id: "memory-mate-8x10", canonical_product_revision: 7, width_in: 10, height_in: 8, orientation: "landscape" }] },
    { id: "stale-revision", ordinal: 3, products: [{ canonical_product_id: "memory-mate-8x10", canonical_product_revision: 6, width_in: 8, height_in: 10, orientation: "portrait" }] },
    { id: "same-dimensions-wrong-product", ordinal: 4, products: [{ canonical_product_id: "magazine-cover-8x10", canonical_product_revision: 7, width_in: 8, height_in: 10, orientation: "portrait" }] },
  ];
  const compatible = compatibleTemplateOutputs(outputs, product);
  assert.deepEqual(compatible.map(({ id }) => id), ["memory-mate-portrait", "memory-mate-landscape"]);
  assert.equal(compatibleOutputVariantSummary(compatible[0], product), "portrait");
  assert.equal(compatibleOutputVariantSummary(compatible[1], product), "landscape");
});

test("preserves every returned print while excluding only exact unconfirmed plaque IDs", () => {
  const products = [
    { id: "print-8x10", revision: 2, fulfillment_type: "print" },
    { id: "print-16x20", revision: 3, fulfillment_type: "print" },
    { id: "future-fine-art-print", revision: 1, fulfillment_type: "print" },
    { id: "contemporary-plaque-5x7", revision: 1, fulfillment_type: "print" },
    { id: "contemporary-plaque-8x10", revision: 1, fulfillment_type: "print" },
    { id: "digital-download", revision: 1, fulfillment_type: "digital" },
  ];
  assert.deepEqual(visibleStorefrontProducts(products).map(({ id }) => id), [
    "print-8x10",
    "print-16x20",
    "future-fine-art-print",
  ]);
});
