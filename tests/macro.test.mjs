import "./support/setup.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { MACRO_KIND, encodeMacros, decodeMacros } from "../web/js/codecs.js";
import {
  keyStep, tapSteps, comboSteps, recordedSteps, textSteps, stuckTargets, releaseSteps, macroDuration, withDelay,
  macroItems, stepsFromItems, moveItem,
} from "../web/js/macro.js";

const brief = (steps) => steps.map(({ kind, pressed, code }) => `${kind}${pressed ? "↓" : "↑"}${code}`);

test("macro: modifiers are their own kind, keys are keys", () => {
  assert.equal(keyStep(0xe1, true).kind, MACRO_KIND.modifier);
  assert.equal(keyStep(0x04, true).kind, MACRO_KIND.key);
  assert.equal(keyStep(0x04, true, 99999).delay, 65535);
});

test("macro: a combination presses in order and releases in reverse", () => {
  assert.deepEqual(brief(comboSteps([0xe0, 0x06])), ["1↓224", "2↓6", "2↑6", "1↑224"]);
  assert.deepEqual(brief(tapSteps({ kind: MACRO_KIND.mouse, code: 1 })), ["3↓1", "3↑1"]);
});

test("macro: recorded events keep their pauses, or take a fixed delay", () => {
  const events = [
    { code: 0xe1, pressed: true, at: 0 },
    { code: 0x04, pressed: true, at: 120.4 },
    { code: 0x04, pressed: false, at: 200 },
    { code: 0xe1, pressed: false, at: 260 },
  ];
  const steps = recordedSteps(events);
  assert.deepEqual(brief(steps), ["1↓225", "2↓4", "2↑4", "1↑225"]);
  assert.deepEqual(steps.map((step) => step.delay), [120, 80, 60, 20]);
  assert.deepEqual(recordedSteps(events, { recordDelays: false, delay: 5 }).map((step) => step.delay), [5, 5, 5, 5]);
});

test("macro: text is typed on a US layout with Shift held across a run", () => {
  const { steps, skipped } = textSteps("Hi!\nж");
  assert.deepEqual(brief(steps), [
    "1↓225", "2↓11", "2↑11",           // H
    "1↑225", "2↓12", "2↑12",           // i
    "1↓225", "2↓30", "2↑30",           // !
    "1↑225", "2↓40", "2↑40",           // Enter
  ]);
  assert.deepEqual(skipped, ["ж"]);
});

test("macro: keys left held are found and released", () => {
  const steps = [keyStep(0xe0, true), keyStep(0x06, true), keyStep(0x06, false)];
  assert.deepEqual(stuckTargets(steps), [{ kind: MACRO_KIND.modifier, code: 0xe0 }]);
  const fixed = [...steps, ...releaseSteps(steps)];
  assert.deepEqual(stuckTargets(fixed), []);
  assert.equal(macroDuration(fixed), 80);
  assert.deepEqual(withDelay(fixed, 7).map((step) => step.delay), [7, 7, 7, 7]);
});

test("macro: steps survive the bank round trip, modifiers included", () => {
  const macros = Array.from({ length: 32 }, () => []);
  macros[0] = [...comboSteps([0xe0, 0x06], 15), ...tapSteps({ kind: MACRO_KIND.mouse, code: 2 }, 30)];
  const decoded = decodeMacros(encodeMacros(macros));
  assert.deepEqual(decoded[0], macros[0]);
});

test("macro: pauses are items of their own; none means no pause", () => {
  const steps = [keyStep(0x04, true, 0), keyStep(0x04, false, 150)];
  const items = macroItems(steps);
  assert.deepEqual(items.map((item) => item.type), ["action", "action", "pause"]);
  assert.deepEqual(stepsFromItems(items), steps);
  const moved = [{ type: "pause", ms: 40 }, items[0], { type: "pause", ms: 30 }, { type: "pause", ms: 20 }, items[1]];
  assert.deepEqual(stepsFromItems(moved).map((step) => step.delay), [50, 0]);
});

test("macro: moving an item, but never a pause to the front", () => {
  const a = { type: "action", code: 1 };
  const b = { type: "action", code: 2 };
  const pause = { type: "pause", ms: 50 };
  assert.deepEqual(moveItem([a, pause, b], 2, 0), [b, a, pause]);
  assert.deepEqual(moveItem([a, pause, b], 0, 2), null, "the pause would open the macro");
  assert.deepEqual(moveItem([a, b, pause], 2, 1), [a, pause, b]);
  assert.equal(moveItem([a, b], 1, 1), null);
});
