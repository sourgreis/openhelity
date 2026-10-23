import { test } from "node:test";
import assert from "node:assert/strict";
import { KEYS, CANVAS, FN_INDEX } from "../web/js/layout.js";

test("the HE30 has 29 keys in bank order", () => {
  assert.equal(KEYS.length, 29);
  assert.deepEqual(KEYS.map((key) => key.index), Array.from({ length: 29 }, (_, i) => i));
  assert.equal(KEYS[FN_INDEX].label, "Fn");
});

test("five rows, matrix addresses as (row + 1) * 16 + position", () => {
  const rows = [...new Set(KEYS.map((key) => key.y))].sort((a, b) => a - b);
  assert.equal(rows.length, 5);
  for (const key of KEYS) {
    const row = rows.indexOf(key.y);
    const position = KEYS.filter((other) => other.y === key.y && other.x < key.x).length;
    assert.equal(key.matrix, (row + 1) * 16 + position, key.label);
  }
});

test("ANSI widths and everything inside the canvas", () => {
  const width = (label) => KEYS.find((key) => key.label === label).w;
  assert.ok(width("Tab") > width("Q"));
  assert.ok(width("Caps") > width("Tab"));
  assert.ok(width("Shift") > width("Caps"));
  assert.ok(width("Space") > width("Shift"));
  for (const key of KEYS) {
    assert.ok(key.x >= 0 && key.x + key.w <= CANVAS.width, key.label);
    assert.ok(key.y >= 0 && key.y + key.h <= CANVAS.height, key.label);
  }
});

test("each key knows its factory usage", async () => {
  const { FN } = await import("../web/js/layout.js");
  const code = (label) => KEYS.find((key) => key.label === label).code;
  assert.equal(code("Q"), 0x14);
  assert.equal(code("Shift"), 0xe1);
  assert.equal(code("Fn"), FN);
  assert.ok(KEYS.every((key) => Number.isInteger(key.code)));
});
