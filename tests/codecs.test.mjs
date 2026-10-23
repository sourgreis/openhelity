import "./support/setup.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeKeymap, encodeKeymap, decodeTravel, encodeTravel, MAX_ACTUATION, TRAVEL_UNIT,
  decodeConfig, applyConfig, decodeColors, encodeColors,
  decodePairBank, encodePairBank, decodeToggleBank, encodeToggleBank,
  decodeDksBank, encodeDksBank, decodeMacros, encodeMacros, MACRO_KIND, MACRO_MAX_STEPS,
} from "../web/js/codecs.js";

const random = (length, seed = 1) => Array.from({ length }, (_, i) => ((i + 1) * 7919 * seed) % 256);

test("keymap: entries, names and a round trip", () => {
  const bank = new Array(384).fill(0xff);
  bank.splice(0, 3, 0x10, 0x00, 0x14);
  bank.splice(78, 3, 0xf0, 0xff, 0x01);
  const layer = decodeKeymap(bank);
  assert.equal(layer.length, 128);
  assert.deepEqual(layer[0], { type: 0x10, code1: 0, code2: 0x14, name: "Q" });
  assert.equal(layer[1].type, 0xff);
  assert.deepEqual(encodeKeymap(layer), bank);
});

test("travel: bank steps are 0.02 mm, shown in hundredths", () => {
  assert.equal(TRAVEL_UNIT, 2);
  const bank = new Array(1024).fill(0);
  // Actuation 100 steps, Rapid Trigger 11 steps, mode 1.
  bank.splice(0, 8, 0xa5, 0x01, 99, 0, 10, 0, 10, 0);
  const [key] = decodeTravel(bank);
  assert.equal(key.actuation, 200);
  assert.equal(key.rtPress, 22);
  assert.equal(key.mode, 1);
  assert.equal(key.switchType, 5);
  assert.deepEqual(encodeTravel(decodeTravel(bank)).slice(0, 8), bank.slice(0, 8));
});

test("travel: odd hundredths round to a step, and the bank field caps at 511", () => {
  const [bank] = [encodeTravel([{ actuation: 151, rtPress: 2, rtRelease: 2 }, { actuation: 99999 }])];
  const actuation = (key) => (bank[key * 8 + 2] | ((bank[key * 8 + 3] & 1) << 8)) + 1;
  assert.equal(actuation(0), 76);
  assert.equal(actuation(1), 511);
  assert.equal(MAX_ACTUATION, 286);
});

test("config: decode, apply, and undocumented bytes survive", () => {
  // Bytes 32..63 as on a real HE30.
  const raw = new Array(64).fill(0);
  raw.splice(1, 1, 0x01);
  raw.splice(4, 1, 0x13);
  raw.splice(6, 2, 0x05, 0x18 | 0x40 | 0x03);
  raw.splice(8, 9, 3, 80, 2, 1, 1, 0, 0xff, 0x80, 0x00);
  raw.splice(24, 8, 1, 50, 1, 0, 0, 0x20, 0x40, 0x60);
  raw.fill(0x10, 32);
  const settings = decodeConfig(raw);
  const applied = applyConfig(raw, settings);
  assert.deepEqual(applied, raw);
  settings.debounce = 5;
  settings.light.speed = 1;
  settings.light.color = "#102030";
  const next = applyConfig(raw, settings);
  assert.equal(next[7] & 0x18, 0x18, "bits 3 and 4 of byte 7 are kept");
  assert.equal(next[7] >> 5, 5);
  assert.equal(next[10], 3, "speed is stored as 4 - speed");
  assert.deepEqual(next.slice(14, 17), [0x10, 0x20, 0x30]);
  assert.deepEqual(next.slice(32), raw.slice(32));
});

test("config: multicolour flag and the indicator LED", () => {
  // Profile 1 of a live HE30 after its indicator was turned off.
  const raw = [
    0x50, 0x01, 0x05, 0x00, 0x01, 0x00, 0x00, 0x18, 0x03, 0x33, 0x00, 0x00, 0x01, 0x00, 0xff, 0xff,
    0xff, 0x00, 0x64, 0xff, 0x80, 0x00, 0x00, 0x00, 0x02, 0x00, 0x02, 0x00, 0x01, 0xff, 0x00, 0x00,
    ...new Array(32).fill(0x10),
  ];
  const settings = decodeConfig(raw);
  assert.equal(settings.light.multicolor, true);
  assert.deepEqual(settings.indicator, { effect: 2, brightness: 0 });
  settings.light.multicolor = false;
  settings.indicator.brightness = 100;
  const next = applyConfig(raw, settings);
  assert.equal(next[12], 0);
  assert.equal(next[25], 100);
  assert.deepEqual(next.slice(26, 32), raw.slice(26, 32));
});

test("colours: the per-key bank", () => {
  const bank = random(384, 3);
  assert.deepEqual(encodeColors(decodeColors(bank)), bank);
});

test("advanced banks round trip, including the DKS status word", () => {
  const pairs = random(256, 5);
  const pairTail = [...pairs.slice(0, 192), ...new Array(64).fill(0)];
  assert.deepEqual(encodePairBank(decodePairBank(pairs)), pairTail);
  const toggles = random(128, 7);
  assert.deepEqual(encodeToggleBank(decodeToggleBank(toggles)), [...toggles.slice(0, 96), ...new Array(32).fill(0)]);
  const dks = random(1024, 11);
  const decoded = decodeDksBank(dks);
  assert.equal(decoded[0].actions.length, 4);
  assert.deepEqual(encodeDksBank(decoded), [...dks.slice(0, 768), ...new Array(256).fill(0)]);
});

test("macros: round trip, empty slots at 64, overflow refused", () => {
  const macros = Array.from({ length: 32 }, () => []);
  macros[2] = [
    { kind: MACRO_KIND.modifier, pressed: true, code: 0xe1, delay: 10 },
    { kind: MACRO_KIND.key, pressed: true, code: 4, delay: 30 },
    { kind: MACRO_KIND.key, pressed: false, code: 4, delay: 0 },
    { kind: MACRO_KIND.modifier, pressed: false, code: 0xe1, delay: 0 },
  ];
  const bank = encodeMacros(macros);
  assert.equal(bank.length, 2048);
  assert.equal(bank[0] | (bank[1] << 8), 64);
  assert.equal(bank[4] | (bank[5] << 8), 68);
  assert.deepEqual(decodeMacros(bank)[2], macros[2]);
  const tooLong = [Array.from({ length: MACRO_MAX_STEPS + 1 }, () => ({ kind: 2, pressed: true, code: 4, delay: 0 }))];
  assert.throws(() => encodeMacros(tooLong), /overflow/i);
});
