import { MACRO_KIND } from "./codecs.js";

export const MAX_DELAY = 65535;
export const DEFAULT_DELAY = 20;
const LEFT_SHIFT = 0xe1;

const clampDelay = (value) => Math.max(0, Math.min(MAX_DELAY, Math.round(Number(value) || 0)));
const isModifier = (hid) => hid >= 0xe0 && hid <= 0xe7;

export function keyStep(hid, pressed, delay = DEFAULT_DELAY) {
  return { kind: isModifier(hid) ? MACRO_KIND.modifier : MACRO_KIND.key, pressed, code: hid, delay: clampDelay(delay) };
}

export function tapSteps({ kind, code }, delay = DEFAULT_DELAY) {
  return [
    { kind, pressed: true, code, delay: clampDelay(delay) },
    { kind, pressed: false, code, delay: clampDelay(delay) },
  ];
}

export function comboSteps(hids, delay = DEFAULT_DELAY) {
  return [
    ...hids.map((hid) => keyStep(hid, true, delay)),
    ...[...hids].reverse().map((hid) => keyStep(hid, false, delay)),
  ];
}

export function recordedSteps(events, { recordDelays = true, delay = DEFAULT_DELAY } = {}) {
  return events.map((event, index) => {
    const next = events[index + 1];
    const wait = recordDelays && next ? next.at - event.at : delay;
    return keyStep(event.code, event.pressed, wait);
  });
}

// Characters as typed on a US layout: [HID usage, needs Shift].
const TYPED = (() => {
  const map = new Map();
  for (let i = 0; i < 26; i += 1) {
    map.set(String.fromCharCode(97 + i), [4 + i, false]);
    map.set(String.fromCharCode(65 + i), [4 + i, true]);
  }
  "1234567890".split("").forEach((char, i) => { map.set(char, [30 + i, false]); });
  "!@#$%^&*()".split("").forEach((char, i) => { map.set(char, [30 + i, true]); });
  const pairs = [
    [" ", " ", 44], ["\n", "\n", 40], ["\t", "\t", 43],
    ["-", "_", 45], ["=", "+", 46], ["[", "{", 47], ["]", "}", 48], ["\\", "|", 49],
    [";", ":", 51], ["'", "\"", 52], ["`", "~", 53], [",", "<", 54], [".", ">", 55], ["/", "?", 56],
  ];
  for (const [plain, shifted, hid] of pairs) {
    map.set(plain, [hid, false]);
    if (shifted !== plain) map.set(shifted, [hid, true]);
  }
  return map;
})();

export function textSteps(text, delay = DEFAULT_DELAY) {
  const steps = [];
  const skipped = [];
  let shifted = false;
  for (const char of text.replace(/\r\n?/g, "\n")) {
    const typed = TYPED.get(char);
    if (!typed) {
      skipped.push(char);
      continue;
    }
    const [hid, shift] = typed;
    if (shift !== shifted) {
      steps.push(keyStep(LEFT_SHIFT, shift, delay));
      shifted = shift;
    }
    steps.push(keyStep(hid, true, delay), keyStep(hid, false, delay));
  }
  if (shifted) steps.push(keyStep(LEFT_SHIFT, false, delay));
  return { steps, skipped: [...new Set(skipped)] };
}

const sameTarget = (a, b) => a.kind === b.kind && a.code === b.code;

export function stuckTargets(steps) {
  const held = [];
  for (const step of steps) {
    const at = held.findIndex((target) => sameTarget(target, step));
    if (step.pressed && at < 0) held.push({ kind: step.kind, code: step.code });
    if (!step.pressed && at >= 0) held.splice(at, 1);
  }
  return held;
}

export function releaseSteps(steps, delay = DEFAULT_DELAY) {
  return stuckTargets(steps).reverse().map(({ kind, code }) => ({ kind, pressed: false, code, delay: clampDelay(delay) }));
}

export const macroDuration = (steps) => steps.reduce((sum, step) => sum + (Number(step.delay) || 0), 0);

export const withDelay = (steps, delay) => steps.map((step) => ({ ...step, delay: clampDelay(delay) }));

// In the bank a pause is the delay of the step before it; the editor shows it as an item.
export function macroItems(steps) {
  const items = [];
  for (const { kind, pressed, code, delay } of steps) {
    items.push({ type: "action", kind, pressed, code });
    if (delay > 0) items.push({ type: "pause", ms: delay });
  }
  return items;
}

export function stepsFromItems(items) {
  const steps = [];
  for (const item of items) {
    if (item.type === "action") {
      steps.push({ kind: item.kind, pressed: item.pressed, code: item.code, delay: 0 });
    } else if (steps.length) {
      const last = steps[steps.length - 1];
      last.delay = clampDelay(last.delay + clampDelay(item.ms));
    }
  }
  return steps;
}

export function moveItem(items, from, to) {
  if (from === to || to < 0 || to >= items.length) return null;
  const moved = [...items];
  moved.splice(to, 0, ...moved.splice(from, 1));
  return moved[0].type === "action" ? moved : null;
}
