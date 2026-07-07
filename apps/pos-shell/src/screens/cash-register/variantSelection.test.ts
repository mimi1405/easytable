import assert from "node:assert/strict";
import { test } from "node:test";

import { buildSelectedBasketVariants, getDefaultSelections } from "./variantSelection.js";
import type { ProductVariantGroup } from "../../lib/pos-types.js";

const groups: ProductVariantGroup[] = [{
  id: "group_size",
  applies_to: "PRODUCT",
  product_id: "prod_test",
  category: null,
  name: "Size",
  selection_type: "SINGLE",
  min_select: 1,
  max_select: 1,
  is_required: true,
  sort_order: 1,
  items: [{
    id: "item_small",
    variant_group_id: "group_size",
    name: "Small",
    price_delta: 0,
    is_default: true,
    sort_order: 1
  }, {
    id: "item_large",
    variant_group_id: "group_size",
    name: "Large",
    price_delta: 200,
    is_default: false,
    sort_order: 2
  }]
}, {
  id: "group_milk",
  applies_to: "PRODUCT",
  product_id: "prod_test",
  category: null,
  name: "Milk",
  selection_type: "SINGLE",
  min_select: 0,
  max_select: 1,
  is_required: false,
  sort_order: 2,
  items: []
}];

test("getDefaultSelections selects default items only", () => {
  const defaults = getDefaultSelections(groups);

  assert.equal(defaults.group_size?.id, "item_small");
  assert.equal(defaults.group_milk, undefined);
});

test("buildSelectedBasketVariants preserves group and item snapshots", () => {
  const variants = buildSelectedBasketVariants(groups, {
    group_size: groups[0].items[1]
  });

  assert.deepEqual(variants, [{
    variant_group_id: "group_size",
    variant_group_name: "Size",
    variant_item_id: "item_large",
    variant_item_name: "Large",
    price_delta: 200
  }]);
});
