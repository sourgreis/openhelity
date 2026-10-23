import { HID_KEYS } from "./keys.js";

// Outside the HID range: Fn is a layer switch, not a usage.
export const FN = 0x100;

const HE30_CODES = [
  41, 30, 31, 32, 33, 34, 35,  // Esc 1..6
  43, 20, 26, 8, 21, 23,       // Tab Q W E R T
  57, 4, 22, 7, 9, 10,         // Caps A S D F G
  225, 29, 27, 6, 25, 5,       // Shift Z X C V B
  224, FN, 226, 44,            // Ctrl Fn Alt Space
];

const ANSI_ROWS = [
  [41, 53, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 45, 46, 42],
  [43, 20, 26, 8, 21, 23, 28, 24, 12, 18, 19, 47, 48, 49],
  [57, 4, 22, 7, 9, 10, 11, 13, 14, 15, 51, 52, 40],
  [225, 29, 27, 6, 25, 5, 17, 16, 54, 55, 56, 229],
  [224, 227, 226, FN, 44, 230, 231, 101, 228],
];
const ROW_OF = new Map(ANSI_ROWS.flatMap((codes, row) => codes.map((code) => [code, row])));

const UNITS = new Map([
  [42, 2], [43, 1.5], [49, 1.5], [57, 1.75], [40, 2.25], [225, 2.25], [229, 2.75],
  [224, 1.25], [227, 1.25], [226, 1.25], [FN, 1.25], [230, 1.25], [231, 1.25], [101, 1.25], [228, 1.25],
]);
const SPACE = 44;

const LEGENDS = new Map([[57, "Caps"], [225, "Shift"], [229, "Shift"], [224, "Ctrl"], [228, "Ctrl"],
  [226, "Alt"], [230, "Alt"], [227, "Win"], [231, "Win"], [FN, "Fn"]]);

const UNIT = 58;
const GAP = 3;
const MARGIN = 21;

function layoutFromCodes(codes) {
  const rows = [];
  let current = -1;
  codes.forEach((code, index) => {
    const row = ROW_OF.get(code) ?? current;
    if (row > current || !rows.length) {
      rows.push([]);
      current = Math.max(row, current + 1);
    }
    rows[rows.length - 1].push({ code, index });
  });

  const width = (code) => UNITS.get(code) ?? 1;
  const rowUnits = (row) => row.reduce((sum, key) => sum + (key.code === SPACE ? 0 : width(key.code)), 0);
  const widest = Math.max(...rows.map((row) => rowUnits(row) + (row.some((key) => key.code === SPACE) ? 1 : 0)));

  const keys = [];
  rows.forEach((row, rowIndex) => {
    let x = 0;
    row.forEach((key, position) => {
      const units = key.code === SPACE ? Math.max(1, widest - rowUnits(row)) : width(key.code);
      keys.push({
        index: key.index,
        code: key.code,
        label: LEGENDS.get(key.code) ?? HID_KEYS[key.code] ?? "?",
        matrix: (rowIndex + 1) * 16 + position,
        x: Math.round(MARGIN + x * UNIT),
        y: MARGIN + rowIndex * UNIT,
        w: Math.round(units * UNIT - GAP),
        h: UNIT - GAP,
      });
      x += units;
    });
  });

  return {
    keys: Object.freeze(keys.sort((a, b) => a.index - b.index).map(Object.freeze)),
    canvas: Object.freeze({
      width: Math.round(2 * MARGIN + widest * UNIT - GAP),
      height: 2 * MARGIN + rows.length * UNIT - GAP,
    }),
  };
}

const HE30 = layoutFromCodes(HE30_CODES);

export const CANVAS = HE30.canvas;
export const KEYS = HE30.keys;

export const FN_INDEX = KEYS.find((key) => key.label === "Fn").index;
