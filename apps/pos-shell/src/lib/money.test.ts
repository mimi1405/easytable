import assert from "node:assert/strict";
import { test } from "node:test";

import { formatChf, formatPriceDelta } from "./money.js";

test("formatChf formats integer rappen as CHF", () => {
  assert.equal(formatChf(0), "CHF 0.00");
  assert.equal(formatChf(1), "CHF 0.01");
  assert.equal(formatChf(1290), "CHF 12.90");
});

test("formatPriceDelta keeps zero and positive deltas explicit", () => {
  assert.equal(formatPriceDelta(0), "Ohne Aufpreis");
  assert.equal(formatPriceDelta(250), "+CHF 2.50");
});
