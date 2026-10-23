import { test } from "node:test";
import assert from "node:assert/strict";
import { travelAt } from "../web/js/measure.js";

test("the depth at a keystroke is interpolated between samples", () => {
  const before = { travel: 90, time: 100 };
  const after = { travel: 100, time: 115 };
  assert.equal(travelAt(before, after, 100), 90);
  assert.equal(travelAt(before, after, 115), 100);
  assert.equal(travelAt(before, after, 107.5), 95);
});

test("edge cases fall back sensibly", () => {
  assert.equal(travelAt(null, { travel: 42, time: 5 }, 3), 42);
  assert.equal(travelAt({ travel: 10, time: 5 }, { travel: 20, time: 5 }, 5), 20);
  assert.equal(travelAt({ travel: 10, time: 0 }, { travel: 20, time: 10 }, 50), 20, "clamped past the later sample");
});
