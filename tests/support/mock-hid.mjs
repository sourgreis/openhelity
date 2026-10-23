// A WebHID HIDDevice stand-in that answers like the HE30's vendor interface.
const WRITE_COMMANDS = new Set([6, 9, 11, 13, 161, 163, 165, 167]);

export class MockKeyboard {
  constructor({ vendorId = 0x19f5, productId = 0xfd50, silent = false, corrupt = false } = {}) {
    Object.assign(this, { vendorId, productId, silent, corrupt });
    this.productName = "G-COME HE30";
    this.opened = false;
    this.collections = [{ usagePage: 1, usage: 0 }];
    this.sent = [];
    this.inFlight = 0;
    this.maxInFlight = 0;
    this.memory = new Map();
    this.listeners = new Set();
    this.profile = 0;
    this.drop = 0;  // the next requests to leave unanswered
  }

  switchProfile(profile) {
    this.profile = profile;
    this.emit([0xa1, profile * 4, profile, 0, 0, 0, 0, 0, profile ? 0x03 : 0xff, 0, profile]);
  }

  bank(command) {
    if (!this.memory.has(command)) this.memory.set(command, new Uint8Array(8192));
    return this.memory.get(command);
  }

  async open() { this.opened = true; }
  async close() { this.opened = false; }
  addEventListener(type, listener) { if (type === "inputreport") this.listeners.add(listener); }
  removeEventListener(_type, listener) { this.listeners.delete(listener); }

  emit(bytes) {
    const report = new Uint8Array(64);
    report.set(bytes);
    setImmediate(() => {
      for (const listener of this.listeners) listener({ data: new DataView(report.buffer) });
    });
  }

  async sendReport(_id, data) {
    const request = Array.from(data);
    this.sent.push(request);
    if (this.silent) return;
    if (this.drop > 0) {
      this.drop -= 1;
      return;
    }
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    const [, command, , , length, low, high] = request;
    const address = low | (high << 8);
    const reply = [0xaa, ...request.slice(1, 8)];
    if (command === 3) {
      reply.push(...Array.from("HALL_HS_USB_KB,test", (c) => c.charCodeAt(0)));
    } else if (command === 4) {
      // As a live HE30 sends them; data byte 8 is the active profile.
      reply.push(0xf5, 0x19, 0x50, 0xfd, 0x00, 0x04, 0x55, 0x55, this.profile, 0x00, this.profile ? 0x03 : 0xff, 0x00);
    } else if (WRITE_COMMANDS.has(command)) {
      const chunk = request.slice(8, 8 + length);
      if (this.corrupt) chunk[0] ^= 1;
      this.bank(command - 1).set(chunk, address);
    } else if (command !== 14) {
      reply.push(...this.bank(command).slice(address, address + length));
    }
    setImmediate(() => { this.inFlight -= 1; });
    this.emit(reply);
  }
}
