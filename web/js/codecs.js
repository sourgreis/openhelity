import { core, CONSTANTS } from "./core.js";
import { mappingName } from "./keys.js";

export const ADVANCED_SLOTS = CONSTANTS.advancedSlots;
export const MACRO_SLOTS = CONSTANTS.macroSlots;
export const MACRO_MAX_STEPS = CONSTANTS.macroMaxSteps;
export const MACRO_KIND = Object.freeze({ modifier: 1, key: 2, mouse: 3 });

const bytes = (list) => Uint8Array.from(list ?? [], (value) => value & 0xff);
const plain = (typed) => Array.from(typed);
const named = ({ type, code1, code2 }) => ({ type, code1, code2, name: mappingName({ type, code1, code2 }) });

export const decodeKeymap = (bank) => core.decodeKeymap(bytes(bank)).map(named);
export const encodeKeymap = (mappings) => plain(core.encodeKeymap(mappings));

export const TRAVEL_UNIT = 2;  // hundredths of a millimetre per bank step
export const MAX_ACTUATION = 143 * TRAVEL_UNIT;  // the firmware caps the actuation point here

const toHundredths = (value) => value * TRAVEL_UNIT;
const toSteps = (hundredths) => Math.min(511, Math.max(1, Math.round((Number(hundredths) || 0) / TRAVEL_UNIT)));

export const decodeTravel = (bank) => core.decodeTravel(bytes(bank)).map((key) => ({
  ...key,
  actuation: toHundredths(key.actuation),
  rtPress: toHundredths(key.rtPress),
  rtRelease: toHundredths(key.rtRelease),
}));

export const encodeTravel = (keys) => plain(core.encodeTravel(Array.from(keys ?? [], (key) => (key ? {
  ...key,
  actuation: toSteps(key.actuation),
  rtPress: toSteps(key.rtPress),
  rtRelease: toSteps(key.rtRelease),
} : key))));

export const decodeConfig = (bank) => core.decodeConfig(bytes(bank));
export const applyConfig = (bank, settings) => plain(core.applyConfig(bytes(bank), settings));
export const decodeColors = (bank) => core.decodeColors(bytes(bank));
export const encodeColors = (colors) => plain(core.encodeColors(colors));

export const decodePairBank = (bank) =>
  core.decodePairBank(bytes(bank)).map(({ first, second }) => ({ first: named(first), second: named(second) }));
export const encodePairBank = (entries) => plain(core.encodePairBank(entries));

export const decodeToggleBank = (bank) => core.decodeToggleBank(bytes(bank)).map(named);
export const encodeToggleBank = (entries) => plain(core.encodeToggleBank(entries));

export const decodeDksBank = (bank) => core.decodeDksBank(bytes(bank)).map(({ points, actions }) => ({
  points,
  actions: actions.map((action) => ({ ...named(action), status: action.status })),
}));
export const encodeDksBank = (entries) => plain(core.encodeDksBank(entries));

export const decodeMacros = (bank) => core.decodeMacros(bytes(bank));
export const encodeMacros = (macros) => plain(core.encodeMacros(macros));
