import { test } from "node:test";
import assert from "node:assert/strict";
import { dksStatus, dksCells, dksPresses, dksFromPresses, DKS_EVENTS } from "../web/js/dks.js";

test("status words match what the vendor driver wrote", () => {
  // Read back from banks the vendor driver saved.
  assert.equal(dksStatus([1, 0, 0, 0]), 0x0001);
  assert.equal(dksStatus([0, 1, 0, 0]), 0x0008);
  assert.equal(dksStatus([0, 0, 1, 0]), 0x0040);
  assert.equal(dksStatus([0, 0, 0, 1]), 0x0200);
  assert.equal(dksStatus([7, 7, 3, 0]), 0x00ff);
  assert.equal(dksStatus([0, 0, 3, 0]), 0x00c0);
  assert.deepEqual(dksCells(0x00ff), [7, 7, 3, 0]);
});

test("presses and cells convert both ways", () => {
  assert.deepEqual(dksPresses([7, 7, 3, 0]), [{ start: 0, release: 3 }]);
  assert.deepEqual(dksPresses([1, 0, 3, 0]), [{ start: 0, release: null }, { start: 2, release: 3 }]);
  assert.deepEqual(dksFromPresses([{ start: 0, release: 3 }]), [7, 7, 3, 0]);
  assert.deepEqual(dksFromPresses([{ start: 3, release: null }]), [0, 0, 0, 1]);
});

test("every row the editor can produce survives a round trip", () => {
  const rows = [];
  const walk = (event, presses) => {
    if (event >= DKS_EVENTS) { rows.push(presses); return; }
    walk(event + 1, presses);
    walk(event + 1, [...presses, { start: event, release: null }]);
    for (let release = event + 1; release < DKS_EVENTS; release += 1) {
      walk(release, [...presses, { start: event, release }]);
    }
  };
  walk(0, []);
  assert.ok(rows.length > 10);
  for (const presses of rows) {
    const cells = dksFromPresses(presses);
    assert.deepEqual(dksPresses(cells), presses);
    assert.deepEqual(dksCells(dksStatus(cells)), cells);
  }
});
