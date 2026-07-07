import assert from "node:assert/strict";
import { test } from "node:test";

import { buildSelectedBasketVariants, getDefaultSelections } from "./variantSelection.js";
import type { ProductVariantGroup } from "../../lib/local-master.js";

const groups: ProductVariantGroup[] = [{
  id: "group_spice",
  applies_to: "PRODUCT",
  product_id: "prod_test",
  category: null,
  name: "Spice",
  selection_type: "SINGLE",
  min_select: 1,
  max_select: 1,
  is_required: true,
  sort_order: 1,
  items: [{
    id: "item_mild",
    variant_group_id: "group_spice",
    name: "Mild",
    price_delta: 0,
    is_default: true,
    sort_order: 1
  }, {
    id: "item_hot",
    variant_group_id: "group_spice",
    name: "Hot",
    price_delta: 100,
    is_default: false,
    sort_order: 2
  }]
}];

test("getDefaultSelections selects the default staff variant", () => {
  const defaults = getDefaultSelections(groups);

  assert.equal(defaults.group_spice?.id, "item_mild");
});

test("buildSelectedBasketVariants returns selected staff basket variant snapshots", () => {
  const variants = buildSelectedBasketVariants(groups, {
    group_spice: groups[0].items[1]
  });

  assert.deepEqual(variants, [{
    variant_group_id: "group_spice",
    variant_group_name: "Spice",
    variant_item_id: "item_hot",
    variant_item_name: "Hot",
    price_delta: 100
  }]);
});
