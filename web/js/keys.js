import { label } from "./i18n.js";

export const HID_KEYS = Object.freeze({
  0: "", 4: "A", 5: "B", 6: "C", 7: "D", 8: "E", 9: "F", 10: "G", 11: "H",
  12: "I", 13: "J", 14: "K", 15: "L", 16: "M", 17: "N", 18: "O", 19: "P",
  20: "Q", 21: "R", 22: "S", 23: "T", 24: "U", 25: "V", 26: "W", 27: "X",
  28: "Y", 29: "Z", 30: "1", 31: "2", 32: "3", 33: "4", 34: "5", 35: "6",
  36: "7", 37: "8", 38: "9", 39: "0", 40: "Enter", 41: "Esc", 42: "Backspace",
  43: "Tab", 44: "Space", 45: "-", 46: "=", 47: "[", 48: "]", 49: "\\",
  51: ";", 52: "'", 53: "`", 54: ",", 55: ".", 56: "/", 57: "CapsLock",
  58: "F1", 59: "F2", 60: "F3", 61: "F4", 62: "F5", 63: "F6", 64: "F7",
  65: "F8", 66: "F9", 67: "F10", 68: "F11", 69: "F12", 70: "PrintScreen",
  71: "ScrollLock", 72: "Pause", 73: "Insert", 74: "Home", 75: "PageUp",
  76: "Delete", 77: "End", 78: "PageDown", 79: "→", 80: "←", 81: "↓", 82: "↑",
  83: "NumLock", 84: "Num /", 85: "Num *", 86: "Num -", 87: "Num +",
  88: "Num Enter", 89: "Num 1", 90: "Num 2", 91: "Num 3", 92: "Num 4",
  93: "Num 5", 94: "Num 6", 95: "Num 7", 96: "Num 8", 97: "Num 9",
  98: "Num 0", 99: "Num .", 101: "Menu",
  104: "F13", 105: "F14", 106: "F15", 107: "F16", 108: "F17", 109: "F18",
  110: "F19", 111: "F20", 112: "F21", 113: "F22", 114: "F23", 115: "F24",
});

export const MODIFIERS = Object.freeze([
  "Ctrl", "Shift", "Alt", "Win", "RCtrl", "RShift", "RAlt", "RWin",
]);

export const MOUSE_BUTTONS = Object.freeze({
  1: "Left click",
  2: "Right click",
  4: "Middle click",
  8: "Mouse forward",
  16: "Mouse back",
});

export const SYSTEM_CONTROLS = Object.freeze({
  1: "Power",
  2: "Sleep",
  4: "Wake",
});

export const CONSUMER_CONTROLS = Object.freeze({
  "233:0": "Volume +",
  "234:0": "Volume −",
  "226:0": "Mute",
  "205:0": "Play / pause",
  "183:0": "Stop",
  "182:0": "Previous track",
  "181:0": "Next track",
  "111:0": "Screen brightness +",
  "112:0": "Screen brightness −",
  "131:1": "Media player",
  "146:1": "Calculator",
  "148:1": "My computer",
  "138:1": "Email",
  "207:0": "Siri",
  "154:1": "Launchpad",
  "35:2": "Browser: home",
  "39:2": "Browser: reload",
  "38:2": "Browser: stop",
  "37:2": "Browser: forward",
  "36:2": "Browser: back",
  "42:2": "Browser: favourites",
  "33:2": "Browser: search",
});

export const SPECIAL_FUNCTIONS = Object.freeze({
  "4:0": "Windows mode",
  "5:0": "macOS mode",
  "6:0": "Toggle Windows / macOS",
  "8:0": "Factory reset (hold 3 s)",
  "27:0": "Indicator on / off",
  "28:0": "Indicator brightness +",
  "46:0": "Lighting effect +",
  "47:0": "Lighting effect −",
  "48:0": "Pick effect",
  "50:0": "Brightness +",
  "51:0": "Brightness −",
  "53:0": "Backlight off",
  "254:0": "Recalibrate",
  "54:0": "Speed +",
  "55:0": "Speed −",
  "56:0": "Lighting speed +",
  "60:0": "Colour −",
  "61:0": "Colour +",
  "62:0": "Pick colour",
  "87:0": "Open driver website",
  "160:0": "N-Key Rollover",
  "251:0": "Profile 3",
  "252:0": "Profile 2",
  "253:0": "Profile 1",
  ...Object.fromEntries(Array.from({ length: 12 }, (_, layer) =>
    [`255:${layer}`, layer === 0 ? "Fn" : `Fn${layer}`])),
});

export const MAIN_LIGHT_EFFECTS = Object.freeze([
  { value: 255, name: "Off" },
  { value: 128, name: "Music rhythm", hostDriven: true },
  { value: 0, name: "Custom (per-key colours)" },
  { value: 1, name: "Spectrum" },
  { value: 2, name: "Stairs" },
  { value: 3, name: "Static" },
  { value: 4, name: "Breathing" },
  { value: 5, name: "Hundred flowers" },
  { value: 6, name: "Waves" },
  { value: 7, name: "Up and down waves" },
  { value: 8, name: "Fountain" },
  { value: 9, name: "Galaxy" },
  { value: 10, name: "Rotation" },
  { value: 11, name: "Tide" },
  { value: 12, name: "Ocean waves" },
  { value: 13, name: "Ripples" },
  { value: 14, name: "Always-on ripples" },
  { value: 15, name: "Single point" },
  { value: 16, name: "Grid" },
  { value: 17, name: "Piano" },
  { value: 18, name: "Flowing light" },
  { value: 19, name: "Raindrops" },
  { value: 20, name: "Starlight" },
  { value: 21, name: "Fireworks" },
  { value: 22, name: "Waveband" },
]);

/** The vendor driver's preset label (M0, M1, …) for a main lighting effect. */
export function effectSlot(value) {
  if (value === 128) return "M0";
  if (value >= 0 && value <= 22) return `M${value + 1}`;
  return null;
}

export const INDICATOR_EFFECTS = Object.freeze([
  { value: 2, name: "Static" },
  { value: 1, name: "Colour cycle" },
  { value: 3, name: "Blinking" },
]);

export const REPORT_RATES = Object.freeze([
  { value: 0, name: "8000 Hz" },
  { value: 1, name: "4000 Hz" },
  { value: 2, name: "2000 Hz" },
  { value: 3, name: "1000 Hz" },
]);

export const TICK_RATES = Object.freeze([
  { value: 0, name: "Off" },
  { value: 1, name: "30" },
  { value: 2, name: "60" },
]);

export const PRECISION_STEPS = Object.freeze([0.01, 0.005, 0.001]);

export const WHEEL = Object.freeze({ up: "Wheel up", down: "Wheel down" });

const byValue = (list) => Object.fromEntries(list.map((entry) => [entry.value, entry.name]));

export const NAME_TABLES = Object.freeze({
  mouse: MOUSE_BUTTONS,
  system: SYSTEM_CONTROLS,
  consumer: CONSUMER_CONTROLS,
  special: SPECIAL_FUNCTIONS,
  wheel: WHEEL,
  "effect.main": byValue(MAIN_LIGHT_EFFECTS),
  "effect.indicator": byValue(INDICATOR_EFFECTS),
  "rate.report": byValue(REPORT_RATES),
  "rate.tick": byValue(TICK_RATES),
});

export function mappingName({ type, code1, code2 }) {
  if (type === 0 || type === 255) return "";
  if (type === 0x10) {
    const parts = MODIFIERS.filter((_, bit) => code1 & (1 << bit));
    if (code2) parts.push(HID_KEYS[code2] ?? `HID ${code2}`);
    return parts.join("+");
  }
  if (type === 0x20) return label(`mouse.${code1}`, MOUSE_BUTTONS[code1]) || `mouse ${code1}`;
  if (type === 0x21) return code2 === 255 ? label("wheel.down", WHEEL.down) : label("wheel.up", WHEEL.up);
  if (type === 0x30) {
    const code = `${code1}:${code2}`;
    return label(`consumer.${code}`, CONSUMER_CONTROLS[code]) || `consumer ${code}`;
  }
  if (type === 0x40) return label(`system.${code1}`, SYSTEM_CONTROLS[code1]) || `system ${code1}`;
  if (type === 0x70) return `Macro ${code1 + 1}`;
  if (type === 0x90) return `DKS ${code1 + 1}`;
  if (type === 0x91) return `Toggle ${code1 + 1}`;
  if (type === 0x92) return `Mod-Tap ${code1 + 1}`;
  if (type === 0x93) return `Key pair ${code1 + 1}`;
  if (type === 0x94) return `SOCD ${code1 + 1}`;
  if (type === 0xf0) {
    const code = `${code1}:${code2}`;
    return label(`special.${code}`, SPECIAL_FUNCTIONS[code]) || `function ${code}`;
  }
  return `type ${type}:${code1}:${code2}`;
}

// KeyboardEvent.code names the physical key, so recording ignores the OS input language.
const EVENT_CODE_TO_HID = (() => {
  const map = new Map();
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").forEach((letter, index) => {
    map.set(`Key${letter}`, 4 + index);
  });
  for (let digit = 1; digit <= 9; digit += 1) map.set(`Digit${digit}`, 29 + digit);
  map.set("Digit0", 39);
  for (let n = 1; n <= 12; n += 1) map.set(`F${n}`, 57 + n);
  for (let n = 13; n <= 24; n += 1) map.set(`F${n}`, 91 + n);
  for (let n = 1; n <= 9; n += 1) map.set(`Numpad${n}`, 88 + n);

  const fixed = {
    Enter: 40, Escape: 41, Backspace: 42, Tab: 43, Space: 44, Minus: 45,
    Equal: 46, BracketLeft: 47, BracketRight: 48, Backslash: 49, Semicolon: 51,
    Quote: 52, Backquote: 53, Comma: 54, Period: 55, Slash: 56, CapsLock: 57,
    PrintScreen: 70, ScrollLock: 71, Pause: 72, Insert: 73, Home: 74,
    PageUp: 75, Delete: 76, End: 77, PageDown: 78,
    ArrowRight: 79, ArrowLeft: 80, ArrowDown: 81, ArrowUp: 82,
    NumLock: 83, NumpadDivide: 84, NumpadMultiply: 85, NumpadSubtract: 86,
    NumpadAdd: 87, NumpadEnter: 88, Numpad0: 98, NumpadDecimal: 99,
    ContextMenu: 101,
    ControlLeft: 224, ShiftLeft: 225, AltLeft: 226, MetaLeft: 227,
    ControlRight: 228, ShiftRight: 229, AltRight: 230, MetaRight: 231,
  };
  for (const [code, hid] of Object.entries(fixed)) map.set(code, hid);
  return map;
})();

export function eventCodeToHid(code) {
  return EVENT_CODE_TO_HID.get(code) ?? null;
}

export function macroTargets() {
  const targets = [];
  for (const [code, name] of Object.entries(HID_KEYS)) {
    if (name && Number(code) > 0) targets.push({ value: `2:${code}`, name });
  }
  MODIFIERS.forEach((name, bit) => { targets.push({ value: `1:${0xe0 + bit}`, name }); });
  for (const [mask, name] of Object.entries(MOUSE_BUTTONS)) {
    targets.push({ value: `3:${mask}`, name: label(`mouse.${mask}`, name) });
  }
  return targets;
}
