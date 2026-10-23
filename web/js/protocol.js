import { t } from "./i18n.js";
import { core, CONSTANTS } from "./core.js";

export const REPORT_SIZE = CONSTANTS.reportSize;
export const RESPONSE_PREFIX = CONSTANTS.responsePrefix;
export const PROFILE_COUNT = CONSTANTS.profileCount;
export const LAYERS_PER_PROFILE = CONSTANTS.layersPerProfile;

export const DEVICE_MODELS = Object.freeze({
  "19f5:fd50": { name: "ZUOYA HE30 (G-COME)", type: 101 },
});

export const DEVICE_FILTERS = Object.freeze(
  Object.keys(DEVICE_MODELS).map((id) => {
    const [vendorId, productId] = id.split(":").map((hex) => parseInt(hex, 16));
    return { vendorId, productId, usagePage: 0x0001, usage: 0x0000 };
  }),
);

const REPLY_TIMEOUT_MS = 2000;
const READ_ATTEMPTS = 3;
const DEVICE_LOCK = "openhelity-keyboard";
const MAX_FOREIGN_REPORTS = 4;

const BANK_LABELS = {
  config: "bank.config",
  colors: "bank.colors",
  keymap: "bank.keymap",
  travel: "bank.travel",
  dks: "bank.dks",
  pairs: "bank.pairs",
  toggles: "bank.toggles",
  macros: "bank.macros",
};

const hex4 = (value) => Number(value).toString(16).padStart(4, "0");
const ignore = () => {};

function reports(flat) {
  const list = [];
  for (let at = 0; at < flat.length; at += REPORT_SIZE) list.push(flat.slice(at, at + REPORT_SIZE));
  return list;
}

export function decodeTelemetry(report) {
  return { ...core.decodeTelemetry(Uint8Array.from(report)), report };
}

function modelOf(device) {
  return DEVICE_MODELS[`${hex4(device.vendorId)}:${hex4(device.productId)}`]
    ?? { name: device.productName || "HE30", type: 101 };
}

const isSupported = (device) => DEVICE_FILTERS.some((filter) =>
  device.vendorId === filter.vendorId
  && device.productId === filter.productId
  && (device.collections ?? []).some(({ usagePage, usage }) =>
    usagePage === filter.usagePage && usage === filter.usage));

function timedOut() {
  const error = new Error(t("error.timeout"));
  error.code = "timeout";
  return error;
}

/**
 * One keyboard behind WebHID. Requests take turns, each getting the next reply;
 * layer changes and telemetry arrive as `layer` and `telemetry` events instead.
 */
export class HE30Device extends EventTarget {
  #log;
  #connected = false;
  #turn = Promise.resolve();
  #reply = null;
  #release = null;
  #telemetry = null;
  #receive = (event) => this.#route(event.data);

  /**
   * @param {HIDDevice} device an already chosen WebHID device
   * @param {(level: string, message: string) => void} [log]
   */
  constructor(device, log = ignore) {
    super();
    this.device = device;
    this.model = modelOf(device);
    this.#log = log;
  }

  /** Lets the user pick a keyboard, then opens it. */
  static async choose(log) {
    if (!navigator.hid) throw new Error(t("error.noWebHid"));
    const [device] = await navigator.hid.requestDevice({ filters: DEVICE_FILTERS });
    if (!device) throw new Error(t("error.notSelected"));
    return HE30Device.#connect(device, log);
  }

  /** Opens a keyboard the page was allowed to use before, if one is plugged in. */
  static async reconnect(log) {
    const device = navigator.hid && (await navigator.hid.getDevices()).find(isSupported);
    return device ? HE30Device.#connect(device, log) : null;
  }

  static async #connect(device, log) {
    const board = new HE30Device(device, log);
    await board.open();
    return board;
  }

  async open() {
    await this.#lock();
    try {
      if (!this.device.opened) await this.device.open();
    } catch (error) {
      this.#unlock();
      throw error;
    }
    this.device.addEventListener("inputreport", this.#receive);
    this.#connected = true;
    this.#log("info", t("log.opened", { name: this.model.name }));
  }

  async close() {
    this.#connected = false;
    this.#unlock();
    this.device.removeEventListener("inputreport", this.#receive);
    this.#settle((pending) => pending.reject(new Error(t("error.disconnected"))));
    if (this.device.opened) await this.device.close();
  }

  // A Web Lock keeps a second window off the keyboard; it is held until #unlock().
  async #lock() {
    if (!navigator.locks || this.#release) return;
    const granted = Promise.withResolvers();
    navigator.locks.request(DEVICE_LOCK, { ifAvailable: true }, (lock) => {
      if (!lock) {
        granted.reject(new Error(t("error.inUse")));
        return undefined;
      }
      const held = Promise.withResolvers();
      this.#release = held.resolve;
      granted.resolve();
      return held.promise;
    }).catch(granted.reject);
    await granted.promise;
  }

  #unlock() {
    this.#release?.();
    this.#release = null;
  }

  onLayer(listener) { return this.#listen("layer", listener); }
  onTelemetry(listener) { return this.#listen("telemetry", listener); }

  #listen(type, listener) {
    const handler = (event) => listener(event.detail);
    this.addEventListener(type, handler);
    return () => this.removeEventListener(type, handler);
  }

  #route(view) {
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    const kind = core.reportKind(bytes);
    if (kind === "layer") {
      this.dispatchEvent(new CustomEvent("layer", { detail: core.decodeLayerReport(bytes) }));
    } else if (kind === "telemetry") {
      this.dispatchEvent(new CustomEvent("telemetry", { detail: decodeTelemetry(Array.from(bytes)) }));
    } else {
      this.#settle((pending) => pending.resolve(Array.from(bytes)));
    }
  }

  // Requests take turns, so at most one reply is ever awaited.
  #awaitReply() {
    const pending = Promise.withResolvers();
    pending.timer = setTimeout(() => this.#settle((expired) => expired.reject(timedOut())), REPLY_TIMEOUT_MS);
    this.#reply = pending;
    return pending.promise;
  }

  #settle(outcome) {
    const pending = this.#reply;
    if (!pending) return;
    this.#reply = null;
    clearTimeout(pending.timer);
    outcome(pending);
  }

  #ask(request) {
    const answer = this.#turn.then(() => this.#exchange(request));
    this.#turn = answer.then(ignore, ignore);
    return answer;
  }

  async #exchange(request) {
    if (!this.#connected) throw new Error(t("error.disconnected"));
    await this.device.sendReport(0, request);
    // Unrouted reports can still come first; the reply is the one with the response prefix.
    for (let skipped = 0; skipped < MAX_FOREIGN_REPORTS; skipped += 1) {
      const report = await this.#awaitReply();
      if (report[0] === RESPONSE_PREFIX) return report;
    }
    throw new Error(t("error.noAck", { command: request[1] }));
  }

  // Reads are retried, writes never: the keyboard can miss a read right after a write.
  async #askRetrying(request) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.#ask(request);
      } catch (error) {
        if (error.code !== "timeout" || attempt >= READ_ATTEMPTS) throw error;
      }
    }
  }

  async #read(command, offset, size) {
    const data = [];
    for (const request of reports(core.readRequests(command, offset, size))) {
      const reply = await this.#askRetrying(request);
      data.push(...core.replyData(Uint8Array.from(reply), request[4]));
    }
    return data;
  }

  readBank(name, profile, layer = 0) {
    const { read, offset, size } = core.bankRegion(name, profile, layer);
    return this.#read(read, offset, size);
  }

  /** Writes a bank, then reads it back: a write only counts once the keyboard holds the same bytes. */
  async writeBank(name, profile, bytes, layer = 0) {
    const { read, write, offset } = core.bankRegion(name, profile, layer);
    for (const request of reports(core.writeRequests(write, offset, Uint8Array.from(bytes)))) {
      await this.#ask(request);
    }
    const what = t(BANK_LABELS[name], { n: profile + 1, layer });
    const stored = await this.#read(read, offset, bytes.length);
    const index = stored.findIndex((byte, i) => byte !== bytes[i]);
    if (index >= 0) {
      throw new Error(t("error.verify", { what, index, actual: stored[index], expected: bytes[index] }));
    }
    this.#log("ok", t("log.verified", { what }));
  }

  async firmware() {
    return core.parseFirmware(Uint8Array.from(await this.#ask(core.firmwareRequest())));
  }

  async activeProfile() {
    return core.activeProfile(Uint8Array.from(await this.#ask(core.identifiersRequest())));
  }

  readConfig(profile) { return this.readBank("config", profile); }
  writeConfig(profile, bytes) { return this.writeBank("config", profile, bytes); }
  readKeymap(profile, layer) { return this.readBank("keymap", profile, layer); }
  writeKeymap(profile, layer, bytes) { return this.writeBank("keymap", profile, bytes, layer); }
  readTravel(profile) { return this.readBank("travel", profile); }
  writeTravel(profile, bytes) { return this.writeBank("travel", profile, bytes); }
  readColors(profile) { return this.readBank("colors", profile); }
  writeColors(profile, bytes) { return this.writeBank("colors", profile, bytes); }
  readDks(profile) { return this.readBank("dks", profile); }
  writeDks(profile, bytes) { return this.writeBank("dks", profile, bytes); }
  readPairs(profile) { return this.readBank("pairs", profile); }
  writePairs(profile, bytes) { return this.writeBank("pairs", profile, bytes); }
  readToggles(profile) { return this.readBank("toggles", profile); }
  writeToggles(profile, bytes) { return this.writeBank("toggles", profile, bytes); }
  readMacros(profile) { return this.readBank("macros", profile); }
  writeMacros(profile, bytes) { return this.writeBank("macros", profile, bytes); }

  /** The profile live depth is streaming from, or null. */
  get telemetryProfile() {
    return this.#telemetry?.profile ?? null;
  }

  // Live depth needs the telemetry bit in the config; a bit set here is cleared again on stop.
  async startTelemetry(profile) {
    const config = Uint8Array.from(await this.readConfig(profile));
    const streaming = core.withTelemetry(config, true);
    const changed = streaming.some((byte, i) => byte !== config[i]);
    this.#telemetry = { profile, restore: changed };
    if (changed) await this.writeConfig(profile, Array.from(streaming));
  }

  async stopTelemetry() {
    const session = this.#telemetry;
    this.#telemetry = null;
    if (!session?.restore) return;
    const config = Uint8Array.from(await this.readConfig(session.profile));
    await this.writeConfig(session.profile, Array.from(core.withTelemetry(config, false)));
  }
}
