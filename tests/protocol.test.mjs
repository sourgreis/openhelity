import "./support/setup.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { HE30Device, decodeTelemetry } from "../web/js/protocol.js";
import { MockKeyboard } from "./support/mock-hid.mjs";

async function connect(options) {
  const keyboard = new MockKeyboard(options);
  const board = new HE30Device(keyboard);
  await board.open();
  return { keyboard, board };
}

test("a read goes out in 56-byte chunks with the documented framing", async () => {
  const { keyboard, board } = await connect();
  keyboard.bank(5).set([1, 2, 3], 64);
  const config = await board.readConfig(1);
  assert.equal(config.length, 64);
  assert.deepEqual(config.slice(0, 3), [1, 2, 3]);
  const [first, second] = keyboard.sent;
  assert.deepEqual(first.slice(0, 7), [0x55, 5, 0, (64 + 56) & 0xff, 56, 64, 0]);
  assert.deepEqual(second.slice(0, 7), [0x55, 5, 0, (120 + 8) & 0xff, 8, 120, 0]);
});

test("a write carries the data from byte 8 and is verified", async () => {
  const { keyboard, board } = await connect();
  const layer = Array.from({ length: 384 }, (_, i) => i & 0xff);
  await board.writeKeymap(0, 2, layer);
  const write = keyboard.sent.find((report) => report[1] === 9);
  assert.deepEqual(write.slice(4, 8), [56, 0x00, 0x04, 0], "length, address 1024, padding");
  assert.deepEqual(write.slice(8), layer.slice(0, 56));
  assert.deepEqual(Array.from(keyboard.bank(8).slice(1024, 1024 + 384)), layer);
});

test("a write that reads back differently is an error", async () => {
  const { board } = await connect({ corrupt: true });
  await assert.rejects(board.writeToggles(0, new Array(128).fill(0)), /byte 0/);
});

test("requests from several callers never overlap, and each gets its own answer", async () => {
  const { keyboard, board } = await connect();
  keyboard.bank(166).set([7, 7, 7]);
  keyboard.profile = 2;
  const [toggles, firmware, active] = await Promise.all([board.readToggles(0), board.firmware(), board.activeProfile()]);
  assert.equal(keyboard.maxInFlight, 1, "one request on the wire at a time");
  assert.deepEqual(toggles.slice(0, 3), [7, 7, 7]);
  assert.equal(firmware, "HALL_HS_USB_KB,test");
  assert.equal(active, 2);
});

test("the active profile comes from the identifiers reply", async () => {
  const { keyboard, board } = await connect();
  for (const profile of [0, 1, 2]) {
    keyboard.profile = profile;
    assert.equal(await board.activeProfile(), profile);
  }
  assert.deepEqual(keyboard.sent.at(-1).slice(0, 5), [0x55, 4, 0, 32, 32]);
});

test("a profile switched on the keyboard reaches layer listeners", async () => {
  const { keyboard, board } = await connect();
  const changes = [];
  board.onLayer((change) => changes.push(change));
  keyboard.switchProfile(1);
  keyboard.emit([0xa1, 0x05, 0x01]);  // Fn held in profile 2
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(changes, [{ layer: 4, profile: 1 }, { layer: 5, profile: 1 }]);
});

test("the firmware string", async () => {
  const { board } = await connect();
  assert.equal(await board.firmware(), "HALL_HS_USB_KB,test");
});

test("telemetry goes to listeners and never answers a request", async () => {
  const { keyboard, board } = await connect();
  const samples = [];
  board.onTelemetry((sample) => samples.push(sample));
  keyboard.emit([0xa0, 0x10, 0x00, 0x14, 0x03, 0x1e, 0x00, 0xb9]);
  keyboard.emit([0xa1, 0x01]);
  const config = await board.readConfig(0);
  assert.equal(config.length, 64);
  assert.equal(samples.length, 1);
  assert.deepEqual([samples[0].type, samples[0].code1, samples[0].code2], [0x10, 0, 0x14]);
  assert.equal(samples[0].travel, 185);
  assert.equal(samples[0].raw, 0x031e);
});

test("decodeTelemetry tolerates short reports", () => {
  const sample = decodeTelemetry([0xa0]);
  assert.equal(sample.travel, 0);
  assert.equal(sample.type, 0);
});

test("telemetry is switched on only when it was off, and restored", async () => {
  const { keyboard, board } = await connect();
  await board.startTelemetry(0);
  assert.equal(keyboard.bank(5)[7] & 8, 8);
  await board.stopTelemetry();
  assert.equal(keyboard.bank(5)[7] & 8, 0);

  keyboard.bank(5)[7] = 8;
  const before = keyboard.sent.length;
  await board.startTelemetry(0);
  await board.stopTelemetry();
  assert.equal(keyboard.bank(5)[7] & 8, 8, "left on, as it was");
  assert.ok(keyboard.sent.every((report, i) => i < before || report[1] !== 6), "nothing written");
});

test("no reply means a timeout, and the next request still works", async () => {
  const { keyboard, board } = await connect({ silent: true });
  await assert.rejects(board.readConfig(0), /answer in time/);
  keyboard.silent = false;
  assert.equal((await board.readConfig(0)).length, 64);
});

test("closing rejects what is still waiting and refuses new requests", async () => {
  const { board } = await connect({ silent: true });
  const pending = board.readConfig(0);
  await new Promise((resolve) => setImmediate(resolve));
  await board.close();
  await assert.rejects(pending, /disconnected/i);
  await assert.rejects(board.readConfig(0), /disconnected/i);
});

test("a read the keyboard misses is asked again", async () => {
  const { keyboard, board } = await connect();
  keyboard.bank(5).set([9, 8, 7]);
  keyboard.drop = 1;
  const config = await board.readConfig(0);
  assert.deepEqual(config.slice(0, 3), [9, 8, 7]);
  assert.equal(keyboard.sent.filter((report) => report[1] === 5).length, 3, "the first chunk twice, then the second");
});

test("a write the keyboard misses is not repeated", async () => {
  const { keyboard, board } = await connect();
  keyboard.drop = 1;
  await assert.rejects(board.writeToggles(0, new Array(128).fill(0)), /answer in time/);
  assert.equal(keyboard.sent.filter((report) => report[1] === 167).length, 1);
});
