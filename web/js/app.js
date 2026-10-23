import { HE30Device, PROFILE_COUNT, LAYERS_PER_PROFILE } from "./protocol.js";
import {
  decodeKeymap, encodeKeymap, decodeConfig, applyConfig,
  decodeTravel, encodeTravel, decodeColors, encodeColors, decodeMacros, encodeMacros,
  MAX_ACTUATION, TRAVEL_UNIT,
  decodeDksBank, encodeDksBank, decodePairBank, encodePairBank,
  decodeToggleBank, encodeToggleBank,
  MACRO_SLOTS, MACRO_KIND, MACRO_MAX_STEPS, ADVANCED_SLOTS,
} from "./codecs.js";
import { KEYS, CANVAS, FN_INDEX, FN } from "./layout.js";
import { DKS_EVENTS, dksStatus, dksCells, dksPresses, dksFromPresses } from "./dks.js";
import { travelAt } from "./measure.js";
import {
  MAX_DELAY, tapSteps, comboSteps, recordedSteps, textSteps, stuckTargets, releaseSteps,
  macroDuration, withDelay, macroItems, stepsFromItems, moveItem,
} from "./macro.js";
import {
  HID_KEYS, MODIFIERS, MOUSE_BUTTONS, CONSUMER_CONTROLS, SPECIAL_FUNCTIONS,
  MAIN_LIGHT_EFFECTS, INDICATOR_EFFECTS, REPORT_RATES, TICK_RATES,
  PRECISION_STEPS, WHEEL, mappingName, macroTargets, eventCodeToHid, effectSlot,
} from "./keys.js";
import { initLocale, locales, getLocale, setLocale, t, label } from "./i18n.js";

const $ = (id) => document.getElementById(id);

function askConfirm(message) {
  return new Promise((resolve) => {
    const dialog = $("confirm");
    $("confirm-message").textContent = message;
    dialog.returnValue = "cancel";
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok"), { once: true });
    dialog.showModal();
  });
}

async function withBusy(label, run) {
  if (state.busy) throw new Error(t("error.busy"));
  state.busy = true;
  setToolbarBusy(true, label);
  try {
    return await run(setBusyLabel);
  } finally {
    state.busy = false;
    setToolbarBusy(false);
  }
}

function setBusyLabel(label) {
  $("busy").textContent = label;
}

function setToolbarBusy(busy, label = "") {
  for (const id of ["profile", "layer", "reload", "export", "import", "copy", "restore", "write"]) {
    $(id).disabled = busy;
  }
  $("busy").hidden = !busy;
  if (busy) setBusyLabel(label);
  else updateWriteButton();
}

const AUTO_WRITE_DELAY = 3000;
const AUTO_WRITE_KEY = "he30:autoWrite";
const DISCLAIMER_KEY = "he30:disclaimerAccepted";
let autoWriteTimer = 0;
let interacting = false;

function makeFineSlider(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  const perPixel = Number(input.dataset.perPixel) || Math.min(1, Math.max(0.02, (max - min) / 240));
  let drag = null;

  input.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    input.focus();
    try { input.setPointerCapture(event.pointerId); } catch (_) { /* ignore */ }
    drag = { x: event.clientX, y: event.clientY, value: Number(input.value) };
  });

  const downwards = input.dataset.vertical === "down";

  input.addEventListener("pointermove", (event) => {
    if (!drag) return;
    if (!(event.buttons & 1)) {
      finish(event);
      return;
    }
    const moved = downwards
      ? event.clientY - drag.y
      : (drag.y - event.clientY) + (event.clientX - drag.x);
    const next = Math.round(drag.value + moved * perPixel * (event.shiftKey ? 0.25 : 1));
    const clamped = Math.min(max, Math.max(min, next));
    if (clamped === Number(input.value)) return;
    input.value = String(clamped);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  function finish(event) {
    if (!drag) return;
    drag = null;
    try {
      if (input.hasPointerCapture?.(event.pointerId)) input.releasePointerCapture(event.pointerId);
    } catch (_) { /* ignore */ }
    // Native dragging took the native `change` with it; auto-save relies on one.
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  input.addEventListener("pointerup", finish);
  input.addEventListener("pointercancel", finish);
  input.addEventListener("lostpointercapture", finish);
  window.addEventListener("pointerup", finish);
  window.addEventListener("blur", () => finish({}));
}

function makeValueField(field, slider) {
  const scale = field.dataset.unit === "mm" ? 100 : 1;

  const commit = () => {
    const parsed = parseFloat(String(field.value).replace(",", "."));
    if (!Number.isFinite(parsed)) {
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    const raw = Math.round(parsed * scale);
    slider.value = String(Math.min(Number(slider.max), Math.max(Number(slider.min), raw)));
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    slider.dispatchEvent(new Event("change", { bubbles: true }));
  };

  field.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
      field.blur();
    } else if (event.key === "Escape") {
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      field.blur();
    }
  });
  field.addEventListener("blur", commit);
}

function bindInteractionTracking() {
  const continuous = 'input[type="range"], input[type="color"]';
  document.addEventListener("pointerdown", (event) => {
    if (event.target.matches?.(continuous)) interacting = true;
  }, true);
  document.addEventListener("change", () => {
    interacting = false;
    scheduleAutoWrite();
  }, true);
  document.addEventListener("pointerup", () => {
    if (!interacting) return;
    interacting = false;
    scheduleAutoWrite();
  }, true);
}

function updateAutoWriteMode() {
  $("write").hidden = state.autoWrite;
  updateWriteButton();
}

function refreshSaveStatus(pendingCount) {
  const status = $("save-status");
  if (!state.autoWrite || !state.board) {
    status.hidden = true;
    return;
  }
  status.hidden = false;
  status.textContent = t(pendingCount > 0 ? "status.pending" : "status.saved");
}

function scheduleAutoWrite() {
  if (!state.autoWrite || !state.board || interacting) return;
  if (!state.device || changeCount(pendingChanges()) === 0) return;

  clearTimeout(autoWriteTimer);
  autoWriteTimer = setTimeout(() => {
    // Still busy re-reading after a write: wait instead of failing with "keyboard busy".
    if (state.busy) {
      scheduleAutoWrite();
      return;
    }
    writeChanges({ confirm: false }).catch((error) => {
      log("error", error.message);
      showError(error.message);
    });
  }, AUTO_WRITE_DELAY);
}

let messageTimer = 0;
function showError(message) {
  const line = $("toolbar-message");
  line.textContent = message;
  line.title = message;
  line.hidden = false;
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => { line.hidden = true; }, 8000);
}

function applyStaticStrings() {
  for (const element of document.querySelectorAll("[data-i18n]")) {
    element.textContent = t(element.dataset.i18n);
  }
  document.title = `${t("app.title")} ${t("app.subtitle")}`;
  updateDeviceName();
}

function updateDeviceName() {
  $("device-name").textContent = state.board
    ? state.board.model.name
    : t("app.notConnected");
  $("device-dot").classList.toggle("is-online", Boolean(state.board));
  for (const item of document.querySelectorAll(".nav-item")) {
    item.disabled = !state.board;
  }
}

async function changeLocale(value) {
  const applied = await setLocale(value);
  if (applied !== value) {
    $("locale").value = applied;
    showError(t("error.localeFailed", { name: value }));
  }
  applyStaticStrings();
  if (state.device) renderAll();
}

const BACKUP_HISTORY = 5;
const backupKey = (profile) =>
  `he30:backup:${state.board?.device.productId ?? 0}:${profile}`;

function loadBackups(profile) {
  try {
    const raw = localStorage.getItem(backupKey(profile));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    log("error", t("log.backupReadFailed", { message: error.message }));
    return [];
  }
}

const BACKUP_BANKS = Object.freeze([
  "configRaw", "keymapsRaw", "travelRaw", "macrosRaw", "colorsRaw", "dksRaw", "pairRaw", "toggleRaw",
]);

function saveBackup(profile, banks) {
  const snapshot = { savedAt: new Date().toISOString() };
  for (const field of BACKUP_BANKS) snapshot[field] = banks[field];
  const history = loadBackups(profile);
  const sameAsNewest = history[0] && BACKUP_BANKS
    .every((field) => JSON.stringify(history[0][field]) === JSON.stringify(snapshot[field]));
  if (sameAsNewest) return;

  try {
    localStorage.setItem(backupKey(profile),
      JSON.stringify([snapshot, ...history].slice(0, BACKUP_HISTORY)));
  } catch (error) {
    log("error", t("log.backupFailed", { message: error.message }));
  }
}

const state = {
  board: null,
  profile: 0,
  layer: 0,
  selectedKeys: new Set(),
  remapOpen: new Set(["remap.groupBasic"]),
  // The profile the keyboard is in; `profile` is the one open for editing.
  keyboardProfile: null,
  // The split switch's state, or null to derive it from the selection.
  rtSplit: null,
  adv: null,
  macroSlot: 0,
  recording: null,
  macroPanel: null,
  macroCapture: null,
  macroText: "",
  macroDelay: 0,
  macroRecordDelays: true,
  macroRepeats: 1,
  busy: false,
  liveOff: null,
  autoWrite: false,
  device: null,
  draft: null,
};

function log(level, message) {
  const line = document.createElement("div");
  line.className = level;
  line.textContent = `${new Date().toLocaleTimeString()}  ${message}`;
  $("log").append(line);
  $("log").scrollTop = $("log").scrollHeight;
}

async function connect(board = null) {
  try {
    state.board = board ?? await HE30Device.choose(log);
    state.board.device.addEventListener?.("disconnect", handleDisconnect);
    navigator.hid.addEventListener("disconnect", handleDisconnect);
    updateDeviceName();
    $("connect").hidden = true;
    $("disconnect").hidden = false;
    $("intro").hidden = true;
    $("workspace").hidden = false;
    $("toolbar-actions").hidden = false;
    $("auto-write-row").hidden = false;
    try {
      state.keyboardProfile = await state.board.activeProfile();
      state.profile = state.keyboardProfile;
      fillProfileAndLayerSelects();
      $("profile").value = String(state.profile);
    } catch (_) { /* not critical: start from profile 1 */ }
    followKeyboardProfile();
    await reload();
  } catch (error) {
    log("error", error.message);
    showError(error.message);
  }
}

const PROFILE_POLL_MS = 1000;
let profilePoll = 0;
let profilePolling = false;

function followKeyboardProfile() {
  const board = state.board;
  board.onLayer(({ profile }) => keyboardSwitchedTo(profile));
  clearInterval(profilePoll);
  profilePoll = setInterval(() => {
    if (state.board !== board || state.busy || profilePolling || document.hidden) return;
    profilePolling = true;
    board.activeProfile()
      .then(keyboardSwitchedTo)
      .catch(() => { /* a missed poll is harmless; the next one retries */ })
      .finally(() => { profilePolling = false; });
  }, PROFILE_POLL_MS);
}

function keyboardSwitchedTo(profile) {
  if (!state.board || !(profile >= 0 && profile < PROFILE_COUNT)) return;
  if (profile === state.keyboardProfile) return;
  state.keyboardProfile = profile;
  fillProfileAndLayerSelects();
  log("info", t("log.keyboardProfile", { n: profile + 1 }));
  if (profile === state.profile) return;
  if (state.device && changeCount(pendingChanges()) > 0) {
    showError(t("error.keyboardProfileUnsaved", { n: profile + 1, current: state.profile + 1 }));
    startLiveIndicator().catch((error) => log("error", error.message));
    return;
  }
  const previous = state.profile;
  state.profile = profile;
  $("profile").value = String(profile);
  reload().catch((error) => {
    state.profile = previous;
    $("profile").value = String(previous);
    log("error", error.message);
    showError(error.message);
  });
}

function handleDisconnect(event) {
  if (event.device && state.board && event.device !== state.board.device) return;
  clearInterval(profilePoll);
  state.keyboardProfile = null;
  if (state.liveOff) {
    // Not stopLiveIndicator(): the device is gone, there is no bit to clear.
    state.liveOff();
    state.liveOff = null;
  }
  // Frees the cross-window lock; closing an unplugged device is harmless.
  state.board?.close().catch(() => {});
  state.board = null;
  state.device = null;
  state.draft = null;
  updateDeviceName();
  $("connect").hidden = false;
  $("disconnect").hidden = true;
  $("workspace").hidden = true;
  $("intro").hidden = false;
  $("toolbar-actions").hidden = true;
  $("auto-write-row").hidden = true;
  log("error", t("log.disconnected"));
  showError(t("log.disconnected"));
}

async function disconnect() {
  await stopLiveIndicator().catch(() => { /* the device may already be unplugged */ });
  if (state.board) await state.board.close();
  handleDisconnect({});
}

async function reload() {
  return withBusy(t("busy.reading", { n: state.profile + 1 }), () => readProfile());
}

async function readProfile() {
  const board = state.board;
  const profile = state.profile;
  log("info", t("log.reading", { n: profile + 1 }));

  const configRaw = await board.readConfig(profile);
  const keymapsRaw = [];
  for (let layer = 0; layer < LAYERS_PER_PROFILE; layer += 1) {
    keymapsRaw.push(await board.readKeymap(profile, layer));
  }
  const layers = keymapsRaw.map(decodeKeymap);
  const travelRaw = await board.readTravel(profile);
  const macrosRaw = await board.readMacros(profile);
  const dksRaw = await board.readDks(profile);
  const pairRaw = await board.readPairs(profile);
  const toggleRaw = await board.readToggles(profile);
  const colorsRaw = await board.readColors(profile);
  const advanced = {
    dks: decodeDksBank(dksRaw),
    pair: decodePairBank(pairRaw),
    toggle: decodeToggleBank(toggleRaw),
  };
  const travel = decodeTravel(travelRaw);
  const macros = decodeMacros(macrosRaw);
  const colors = decodeColors(colorsRaw);
  const firmware = await board.firmware();

  saveBackup(profile, {
    configRaw, keymapsRaw, travelRaw, macrosRaw, colorsRaw, dksRaw, pairRaw, toggleRaw,
  });
  state.device = {
    firmware, configRaw, keymapsRaw, settings: decodeConfig(configRaw),
    layers, travel, colors, macros, advanced,
  };
  state.draft = structuredClone({
    configRaw, settings: state.device.settings, layers, travel, colors, macros, advanced,
  });
  log("ok", t("log.read", { n: profile + 1 }));
  renderAll();
  startLiveIndicator().catch((error) => log("error", error.message));
}

function renderAll() {
  renderBoard();
  renderLighting();
  renderSettings();
  renderDeviceInfo();
  fillProfileAndLayerSelects();
  renderRemap();
  renderShortcuts();
  renderAdvanced();
  renderMacros();
  renderTravel();
  updateWriteButton();
  $("restore").disabled = loadBackups(state.profile).length === 0;
}

function currentLayer(source = state.draft) {
  return source.layers[state.layer];
}

function renderBoard() {
  const board = $("board");
  board.replaceChildren();
  const base = state.draft.layers[0];

  for (const key of KEYS) {
    const mapping = currentLayer()[key.index];
    const original = state.device.layers[state.layer][key.index];
    const changed = mapping.type !== original.type
      || mapping.code1 !== original.code1
      || mapping.code2 !== original.code2;

    const button = document.createElement("button");
    button.className = "key";
    button.type = "button";
    button.dataset.index = String(key.index);
    button.style.left = `${(key.x / CANVAS.width) * 100}%`;
    button.style.top = `${(key.y / CANVAS.height) * 100}%`;
    button.style.width = `${(key.w / CANVAS.width) * 100}%`;
    button.style.height = `${(key.h / CANVAS.height) * 100}%`;
    button.classList.toggle("is-changed", changed);
    button.classList.toggle("is-selected", state.selectedKeys.has(key.index));
    button.classList.toggle("is-color-changed", state.draft.colors[key.index] !== state.device.colors[key.index]);
    button.style.setProperty("--key-color", state.draft.colors[key.index]);

    const fill = document.createElement("span");
    fill.className = "fill";
    fill.dataset.fill = String(key.index);

    const cap = document.createElement("span");
    cap.className = "cap";
    cap.textContent = key.label;

    const assigned = document.createElement("span");
    const name = mappingName(mapping) || "—";
    assigned.className = "assigned";
    assigned.textContent = name;
    assigned.classList.toggle("is-differs", name !== key.label);

    const depth = document.createElement("span");
    depth.className = "depth";

    const actuation = document.createElement("span");
    actuation.className = "actuation-line";

    const rtPress = document.createElement("span");
    rtPress.className = "rt-press";
    const rtRelease = document.createElement("span");
    rtRelease.className = "rt-release";
    const rtContinuous = document.createElement("span");
    rtContinuous.className = "rt-cont";
    rtContinuous.textContent = "⟳";

    button.append(fill, actuation, cap, assigned, depth, rtPress, rtRelease, rtContinuous);
    button.title = t("board.keyTitle", {
      label: key.label, action: name, index: key.index, matrix: key.matrix,
    });
    board.append(button);
  }

  renderRemap();
  markAdvancedKeys();
  markMacroKeys();
  drawActuationLines();
  drawRapidTrigger();
  if (state.layer === 0 && base[FN_INDEX]?.type !== 0xf0) {
    log("error", t("log.noFnKey"));
  }
  renderSelectionBar();
}

function setSelection(indices) {
  state.selectedKeys = new Set(indices);
  refreshSelection();
}

function refreshSelection() {
  pickAdvancedKeys();
  state.rtSplit = null;
  for (const button of $("board").querySelectorAll(".key")) {
    button.classList.toggle("is-selected", state.selectedKeys.has(Number(button.dataset.index)));
  }
  renderSelectionBar();
  renderRemap();
  renderTravel();
  renderKeyColors();
  if (state.adv) renderAdvanced();
}

function remapCatalogue() {
  const key = (type, code1, code2, label) => ({ type, code1, code2, label });
  const hid = (codes) => codes
    .filter((code) => HID_KEYS[code])
    .map((code) => key(0x10, 0, code, HID_KEYS[code]));

  const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

  return [
    {
      titleKey: "remap.groupBasic",
      items: hid([...range(4, 39), 44, 45, 46, 47, 48, 49, 51, 52, 53, 54, 55, 56, 40, 42, 43, 41, 57]),
    },
    {
      titleKey: "remap.groupModifiers",
      items: MODIFIERS.map((name, bit) => key(0x10, 1 << bit, 0, name)),
    },
    { titleKey: "remap.groupFunction", items: hid([...range(58, 69), ...range(104, 115)]) },
    { titleKey: "remap.groupNavigation", items: hid([70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 101]) },
    { titleKey: "remap.groupNumpad", items: hid([83, 84, 85, 86, 87, 88, ...range(89, 99)]) },
    {
      titleKey: "remap.groupMouse",
      items: Object.entries(MOUSE_BUTTONS)
        .map(([mask, name]) => key(0x20, Number(mask), 0, label(`mouse.${mask}`, name)))
        .concat([key(0x21, 0, 0, label("wheel.up", WHEEL.up)),
                 key(0x21, 0, 255, label("wheel.down", WHEEL.down))]),
    },
    {
      titleKey: "remap.groupMedia",
      items: Object.entries(CONSUMER_CONTROLS).map(([code, name]) => {
        const [code1, code2] = code.split(":").map(Number);
        return key(0x30, code1, code2, label(`consumer.${code}`, name));
      }),
    },
    {
      titleKey: "remap.groupFunctions",
      items: Object.entries(SPECIAL_FUNCTIONS)
        .filter(([code]) => !code.startsWith("255:") && !["251:0", "252:0", "253:0"].includes(code))
        .map(([code, name]) => {
          const [code1, code2] = code.split(":").map(Number);
          return key(0xf0, code1, code2, label(`special.${code}`, name));
        }),
    },
    {
      titleKey: "remap.groupLayers",
      items: Object.entries(SPECIAL_FUNCTIONS)
        .filter(([code]) => code.startsWith("255:") || ["251:0", "252:0", "253:0"].includes(code))
        .map(([code, name]) => {
          const [code1, code2] = code.split(":").map(Number);
          return key(0xf0, code1, code2, label(`special.${code}`, name));
        }),
    },
    {
      titleKey: "remap.groupMacros",
      items: Array.from({ length: MACRO_SLOTS }, (_, slot) =>
        key(0x70, slot, 1, t("macros.slotName", { n: slot + 1 }))),
    },
  ];
}

function renderRemap() {
  const query = $("remap-search").value.trim().toLowerCase();
  const selected = state.selectedKeys.size;
  const labels = KEYS.filter((entry) => state.selectedKeys.has(entry.index)).map((entry) => entry.label);

  $("remap-search").placeholder = t("remap.search");
  $("remap-selection").textContent = selected
    ? labels.join(", ")
    : t("remap.needSelection");

  const groups = [
    { titleKey: "remap.clearKey", items: [{ type: 255, code1: 255, code2: 255, label: t("remap.clearKey") }] },
    ...remapCatalogue(),
  ];
  renderCatalogue($("remap-catalogue"), groups, {
    query,
    disabled: !selected,
    pick: assignToSelection,
    rerender: renderRemap,
    emptyText: t("remap.nothingFound", { query: $("remap-search").value.trim() }),
  });
}

function renderCatalogue(container, groups, { query = "", disabled = false, pick, rerender, emptyText, current }) {
  container.replaceChildren();
  let shown = 0;
  for (const group of groups) {
    const items = group.items.filter((item) => !query || item.label.toLowerCase().includes(query));
    if (!items.length) continue;
    shown += items.length;

    const open = Boolean(query) || state.remapOpen.has(group.titleKey);
    const block = document.createElement("section");
    block.className = "remap-group";
    block.classList.toggle("is-collapsed", !open);
    const title = document.createElement("h3");
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "remap-toggle";
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", t("remap.toggleGroup", { name: t(group.titleKey) }));
    const name = document.createElement("span");
    name.textContent = t(group.titleKey);
    const chevron = document.createElement("span");
    chevron.className = "chevron";
    chevron.setAttribute("aria-hidden", "true");
    toggle.append(name, chevron);
    toggle.addEventListener("click", () => {
      if (state.remapOpen.has(group.titleKey)) state.remapOpen.delete(group.titleKey);
      else state.remapOpen.add(group.titleKey);
      rerender();
    });
    title.append(toggle);
    block.append(title);
    if (!open) {
      container.append(block);
      continue;
    }

    const list = document.createElement("div");
    list.className = "remap-items";
    for (const item of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = item.label;
      button.disabled = disabled;
      button.classList.toggle("is-current", Boolean(current)
        && item.type === current.type && item.code1 === current.code1 && item.code2 === current.code2);
      button.addEventListener("click", () => pick(item));
      list.append(button);
    }
    block.append(list);
    container.append(block);
  }

  if (!shown) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = emptyText;
    container.append(empty);
  }
}

function assignToSelection(item) {
  if (!state.selectedKeys.size) return;
  const mapping = {
    type: item.type, code1: item.code1, code2: item.code2,
    name: mappingName(item),
  };
  const labels = KEYS.filter((entry) => state.selectedKeys.has(entry.index)).map((entry) => entry.label);
  for (const index of state.selectedKeys) currentLayer()[index] = { ...mapping };

  log("ok", t("remap.assignedTo", { action: item.label, keys: labels.join(", ") }));
  renderBoard();
  renderShortcuts();
  updateWriteButton();
}

function renderSelectionBar() {
  const count = state.selectedKeys.size;
  const [only] = state.selectedKeys;
  $("selection-summary").textContent = count === 0
    ? t("board.selectNone")
    : count === 1
      ? t("board.selectedOne", { label: KEYS.find((key) => key.index === only).label })
      : t("board.selected", { n: count });
  $("select-none").disabled = count === 0;
}

function bindBrush() {
  const board = $("board");
  let mode = null;

  const paint = (index) => {
    const selected = state.selectedKeys.has(index);
    if (mode === "add" ? selected : !selected) return false;
    if (mode === "add") state.selectedKeys.add(index);
    else state.selectedKeys.delete(index);
    return true;
  };

  board.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const key = event.target.closest?.(".key");
    if (!key) {
      setSelection([]);
      return;
    }
    event.preventDefault();
    const index = Number(key.dataset.index);
    if ($("panel-macros").classList.contains("is-active")) {
      toggleMacroOnKey(index);
      return;
    }
    try { board.setPointerCapture(event.pointerId); } catch (_) { /* ignore */ }

    if (event.shiftKey && state.selectedKeys.size) {
      const anchor = Math.min(...state.selectedKeys);
      const [from, to] = anchor <= index ? [anchor, index] : [index, anchor];
      for (const entry of KEYS) {
        if (entry.index >= from && entry.index <= to) state.selectedKeys.add(entry.index);
      }
      mode = "add";
    } else {
      mode = state.selectedKeys.has(index) ? "remove" : "add";
      paint(index);
    }
    refreshSelection();
  });

  board.addEventListener("pointermove", (event) => {
    if (!mode) return;
    // The board holds pointer capture, so keys get no pointer events of their own.
    const key = document.elementFromPoint(event.clientX, event.clientY)?.closest?.(".key");
    if (key && paint(Number(key.dataset.index))) refreshSelection();
  });

  const stop = (event) => {
    if (!mode) return;
    mode = null;
    try {
      if (board.hasPointerCapture?.(event.pointerId)) board.releasePointerCapture(event.pointerId);
    } catch (_) { /* ignore */ }
  };
  board.addEventListener("pointerup", stop);
  board.addEventListener("pointercancel", stop);
}

function fillSelect(select, options, value, namespace = null, prefix = () => null) {
  select.replaceChildren();
  for (const option of options) {
    const element = document.createElement("option");
    element.value = String(option.value);
    const name = namespace
      ? label(`${namespace}.${option.value}`, option.name)
      : option.name;
    const before = prefix(option.value);
    element.textContent = before ? `${before} · ${name}` : name;
    element.disabled = Boolean(option.hostDriven);
    select.append(element);
  }
  select.value = String(value);
}

function updateLightingWarning(group, settings, offEffect, fallbackEffect, fallbackName) {
  const warning = $(`${group}-warning`);
  const isOff = settings.effect === offEffect;
  const isDark = settings.brightness === 0;
  warning.replaceChildren();
  warning.hidden = !(isOff || isDark);
  if (warning.hidden) return;

  warning.append(document.createTextNode(t(isOff ? "light.warnOff" : "light.warnDark")));

  const fix = document.createElement("button");
  fix.type = "button";
  fix.textContent = isOff
    ? t("light.fixEffect", { name: fallbackName })
    : t("light.fixBrightness");
  fix.addEventListener("click", () => {
    if (isOff) settings.effect = fallbackEffect;
    else settings.brightness = 80;
    renderLighting();
    updateWriteButton();
  });
  warning.append(document.createElement("br"), fix);
}

const withCurrent = (list, value) => (list.some((entry) => entry.value === value)
  ? list : [...list, { value, name: t("light.effectN", { n: value }) }]);

function renderLighting() {
  const { light, indicator } = state.draft.settings;
  fillSelect($("light-effect"), withCurrent(MAIN_LIGHT_EFFECTS, light.effect), light.effect, "effect.main",
    effectSlot);
  $("light-brightness").value = light.brightness;
  $("light-brightness-value").value = light.brightness;
  $("light-speed").value = light.speed;
  $("light-speed-value").value = light.speed;
  $("light-color").value = light.color;
  $("light-multicolor").checked = light.multicolor;

  fillSelect($("indicator-effect"), withCurrent(INDICATOR_EFFECTS, indicator.effect), indicator.effect,
    "effect.indicator");
  $("indicator-brightness").value = indicator.brightness;
  $("indicator-brightness-value").value = indicator.brightness;

  const effectName = (list, namespace, value) =>
    label(`${namespace}.${value}`, list.find((entry) => entry.value === value)?.name);
  updateLightingWarning("light", light, 255, 3, effectName(MAIN_LIGHT_EFFECTS, "effect.main", 3));

  renderKeyColors();

  const dark = light.effect === 255 || light.brightness === 0;
  const custom = light.effect === 0;
  const hostDriven = MAIN_LIGHT_EFFECTS.some((entry) => entry.value === light.effect && entry.hostDriven);
  $("light-speed").closest("label").classList.toggle("is-inactive", dark || custom || hostDriven);
  $("light-color").closest("label").classList.toggle("is-inactive",
    dark || custom || hostDriven || light.multicolor);
  $("light-multicolor").closest("label").classList.toggle("is-inactive", dark || custom || hostDriven);

  $("light-host").hidden = !hostDriven;
}

function renderKeyColors() {
  const light = state.draft.settings.light;
  const warning = $("perkey-warning");
  warning.replaceChildren();
  warning.hidden = light.effect === 0;
  if (light.effect !== 0) {
    const enable = document.createElement("button");
    enable.type = "button";
    enable.textContent = t("light.perKeyEnable");
    enable.addEventListener("click", () => {
      light.effect = 0;
      renderLighting();
      updateWriteButton();
    });
    warning.append(document.createTextNode(t("light.perKeyOff")), document.createElement("br"), enable);
  }

  const [first] = state.selectedKeys;
  $("key-color").disabled = first === undefined;
  $("key-color-row").classList.toggle("is-inactive", first === undefined);
  if (first !== undefined) $("key-color").value = state.draft.colors[first];
}

function applyKeyColor(color) {
  for (const index of state.selectedKeys) state.draft.colors[index] = color;
  for (const button of $("board").querySelectorAll(".key")) {
    const index = Number(button.dataset.index);
    button.style.setProperty("--key-color", state.draft.colors[index]);
    button.classList.toggle("is-color-changed", state.draft.colors[index] !== state.device.colors[index]);
  }
  updateWriteButton();
}

function renderSettings() {
  const settings = state.draft.settings;
  fillSelect($("report-rate"), REPORT_RATES, settings.reportRate, "rate.report");
  fillSelect($("tick-rate"), TICK_RATES, settings.tickRate, "rate.tick");
  $("debounce").value = settings.debounce;
  $("lock-win").checked = settings.lockWin;
  $("lock-alttab").checked = settings.lockAltTab;
  $("lock-altf4").checked = settings.lockAltF4;
  $("stability").checked = settings.stabilityMode;
}

function renderDeviceInfo() {
  const device = state.board.device;
  const rows = {
    [t("settings.model")]: state.board.model.name,
    [t("settings.product")]: device.productName,
    [t("settings.usb")]: `${device.vendorId.toString(16).padStart(4, "0").toUpperCase()}:`
      + `${device.productId.toString(16).padStart(4, "0").toUpperCase()}`,
    [t("settings.firmware")]: state.device.firmware,
    [t("settings.deviceType")]: state.board.model.type,
    [t("settings.rawConfig")]: state.device.configRaw
      .map((byte) => byte.toString(16).padStart(2, "0")).join(" "),
  };
  const list = $("device-info");
  list.replaceChildren();
  for (const [term, value] of Object.entries(rows)) {
    const dt = document.createElement("dt");
    dt.textContent = term;
    const dd = document.createElement("dd");
    dd.textContent = value;
    list.append(dt, dd);
  }
}

function renderShortcuts() {
  const container = $("shortcuts");
  container.replaceChildren();
  const base = state.draft.layers[0];

  const switchers = KEYS
    .map((key) => ({ key, mapping: base[key.index] }))
    .filter(({ mapping }) => mapping.type === 0xf0 && mapping.code1 === 255);

  if (!switchers.length) {
    container.textContent = t("shortcuts.none");
    return;
  }

  for (const { key, mapping } of switchers) {
    const globalLayer = mapping.code2;
    const profile = Math.floor(globalLayer / LAYERS_PER_PROFILE);
    const layer = globalLayer % LAYERS_PER_PROFILE;

    const heading = document.createElement("h3");
    heading.textContent = t("shortcuts.heading", {
      key: key.label, global: globalLayer, profile: profile + 1, layer,
    });
    container.append(heading);

    if (profile !== state.profile) {
      const note = document.createElement("p");
      note.className = "hint";
      note.textContent = t("shortcuts.otherProfile", { n: profile + 1 });
      container.append(note);
      continue;
    }

    const rows = KEYS
      .map((entry) => ({ entry, mapping: state.draft.layers[layer][entry.index] }))
      .filter(({ entry, mapping: item }) => {
        const name = mappingName(item);
        return name && name !== mappingName(base[entry.index]);
      });

    if (!rows.length) {
      const note = document.createElement("p");
      note.className = "hint";
      note.textContent = t("shortcuts.empty");
      container.append(note);
      continue;
    }

    const table = document.createElement("table");
    table.append(tableHead(t("shortcuts.colCombo"), t("shortcuts.colAction")));
    const body = document.createElement("tbody");
    for (const { entry, mapping: item } of rows) {
      const row = document.createElement("tr");
      const combo = document.createElement("td");
      combo.textContent = `${key.label} + ${entry.label}`;
      const action = document.createElement("td");
      action.textContent = mappingName(item);
      row.append(combo, action);
      body.append(row);
    }
    table.append(body);
    container.append(table);
  }
}

function commonTravelValue(field) {
  const values = [...state.selectedKeys].map((index) => state.draft.travel[index][field]);
  return values.every((value) => value === values[0]) ? values[0] : null;
}

const TRAVEL_SLIDERS = Object.freeze([
  { id: "travel-actuation", field: "actuation" },
  { id: "travel-rt-press", field: "rtPress" },
  { id: "travel-rt-release", field: "rtRelease" },
  { id: "travel-press-deadzone", field: "pressDeadzone" },
  { id: "travel-release-deadzone", field: "releaseDeadzone" },
]);

const travelMm = (hundredths) => t("hall.mm", { n: (hundredths / 100).toFixed(2) });

function renderTravel() {
  const count = state.selectedKeys.size;
  for (const section of ["actuation", "rt"]) {
    $(`${section}-empty`).hidden = count > 0;
    $(`${section}-editor`).hidden = count === 0;
  }
  if (!count) return;

  const [first] = state.selectedKeys;
  renderRapidTrigger();
  for (const { id, field } of TRAVEL_SLIDERS) {
    const value = commonTravelValue(field);
    $(id).value = value ?? state.draft.travel[first][field];
    $(`${id}-value`).value = value === null ? t("hall.mixed") : travelMm(value);
  }

  drawSwitch(commonTravelValue("actuation") ?? state.draft.travel[first].actuation);

  const key = KEYS.find((entry) => entry.index === first);
  const travel = state.draft.travel[first];
  const rows = {
    [t("hall.key")]: count === 1 ? key.label : t("board.selected", { n: count }),
    [t("hall.switchType")]: travel.switchType,
    [t("hall.precision")]: t("hall.mm", { n: PRECISION_STEPS[travel.pressPrecision] ?? PRECISION_STEPS[0] }),
    [t("hall.color")]: state.device.colors[first],
  };
  const list = $("hall-info");
  list.replaceChildren();
  for (const [term, value] of Object.entries(rows)) {
    const dt = document.createElement("dt");
    dt.textContent = term;
    const dd = document.createElement("dd");
    dd.textContent = value;
    list.append(dt, dd);
  }
}

const SWITCH_REST_Y = 90;
const SWITCH_BOTTOM_Y = 130;
const SWITCH_UNITS_PER_MM = 10;
const ARROW_X = 206;
const ARROW_HEAD = { length: 7, halfWidth: 3.5 };

function drawSwitch(hundredths) {
  const depth = Math.min(4, hundredths / 100) * SWITCH_UNITS_PER_MM;
  const end = SWITCH_REST_Y + depth;
  $("switch-moving").setAttribute("transform", `translate(0 ${depth.toFixed(1)})`);
  $("switch-marker").setAttribute("y1", end.toFixed(1));
  $("switch-marker").setAttribute("y2", end.toFixed(1));

  const { length, halfWidth } = ARROW_HEAD;
  const room = SWITCH_BOTTOM_Y - end >= 2 * length;
  const head = (tip, direction) => {
    const base = tip + direction * length;
    return `M${ARROW_X} ${tip} L${ARROW_X - halfWidth} ${base} L${ARROW_X + halfWidth} ${base} Z`;
  };
  $("switch-arrow-heads").setAttribute("d", room ? head(end, 1) + head(SWITCH_BOTTOM_Y, -1) : "");
  $("switch-arrow").setAttribute("y1", (room ? end + length : end).toFixed(1));
  $("switch-arrow").setAttribute("y2", (room ? SWITCH_BOTTOM_Y - length : SWITCH_BOTTOM_Y).toFixed(1));
}

function renderRapidTrigger() {
  const selected = [...state.selectedKeys].map((index) => state.draft.travel[index]);
  const enabled = selected.filter((travel) => travel.mode !== 0);
  const setSwitch = (id, on, mixed) => {
    $(id).checked = on;
    $(id).indeterminate = mixed;
  };
  setSwitch("rt-enabled", enabled.length === selected.length, enabled.length > 0 && enabled.length < selected.length);
  const continuous = enabled.filter((travel) => travel.mode === 2);
  setSwitch("rt-continuous", enabled.length > 0 && continuous.length === enabled.length,
    continuous.length > 0 && continuous.length < enabled.length);

  const split = state.rtSplit ?? selected.some((travel) => travel.rtPress !== travel.rtRelease);
  $("rt-split").checked = split;
  $("rt-single").hidden = split;
  $("rt-split-fields").hidden = !split;
  const press = commonTravelValue("rtPress");
  $("travel-rt-both").value = press ?? selected[0].rtPress;
  $("travel-rt-both-value").value = press === null ? t("hall.mixed") : travelMm(press);

  const off = enabled.length === 0;
  for (const id of ["rt-sensitivity-card", "rt-continuous-card"]) $(id).classList.toggle("is-disabled", off);
  for (const id of ["rt-split", "rt-continuous", "travel-rt-both", "travel-rt-press", "travel-rt-release"]) {
    $(id).disabled = off;
  }

  const total = state.draft.travel.slice(0, KEYS.length).filter((travel) => travel.mode !== 0).length;
  $("rt-count").innerHTML = "";
  const strong = document.createElement("strong");
  strong.textContent = String(total);
  const [before, after] = t("rt.count", { n: "\u0000" }).split("\u0000");
  $("rt-count").append(document.createTextNode(before ?? ""), strong, document.createTextNode(after ?? ""));
}

function applyTravel(field, value) {
  for (const index of state.selectedKeys) state.draft.travel[index][field] = value;
  renderTravel();
  if (field === "actuation") drawActuationLines();
  else drawRapidTrigger();
  updateWriteButton();
}

function drawActuationLines() {
  for (const button of $("board").querySelectorAll(".key")) {
    const travel = state.draft?.travel[Number(button.dataset.index)];
    const line = button.querySelector(".actuation-line");
    if (!travel || !line) continue;
    // Not 100: a bottomed-out line would sit on the key's border.
    const percent = Math.min(96, (travel.actuation / 100 / SWITCH_TRAVEL_MM) * 100);
    line.style.bottom = `${percent.toFixed(1)}%`;
  }
}

const TELEMETRY_MM_PER_UNIT = 0.02;
const SWITCH_TRAVEL_MM = 3.8;

function telemetryKeyIndex(report) {
  const base = state.draft.layers[0];
  const key = KEYS.find(({ index }) => base[index].type === report.type
    && base[index].code1 === report.code1
    && base[index].code2 === report.code2);
  return key?.index ?? null;
}

const lastTelemetry = new Map();
const entryKey = ({ type, code1, code2 }) => `${type}:${code1}:${code2}`;

const pendingFires = [];

function onTelemetry(report) {
  const id = entryKey(report);
  const sample = { travel: report.travel, raw: report.raw, time: performance.now() };
  for (let index = pendingFires.length - 1; index >= 0; index -= 1) {
    const pending = pendingFires[index];
    if (pending.key !== id) continue;
    pendingFires.splice(index, 1);
    pending.done(travelAt(pending.before, sample, pending.time));
  }
  lastTelemetry.set(id, sample);
  const index = telemetryKeyIndex(report);
  if (index === null) return;
  const percent = Math.min(100, Math.round(
    (report.travel * TELEMETRY_MM_PER_UNIT / SWITCH_TRAVEL_MM) * 100));
  const key = $("board").querySelector(`.key[data-index="${index}"]`);
  if (!key) return;
  key.querySelector(".fill").style.height = `${percent}%`;
  key.querySelector(".depth").textContent = percent ? `${percent}%` : "";
}

async function startLiveIndicator() {
  const board = state.board;
  if (!board) return;
  // Telemetry streams only from the profile the keyboard is in, not the one being edited.
  const target = state.keyboardProfile ?? state.profile;
  const bitCleared = target === state.profile && !(state.device.configRaw[7] & 8);
  if (board.telemetryProfile !== target || bitCleared) {
    const previous = board.telemetryProfile;
    if (previous !== null && previous !== undefined && previous !== target) {
      await board.stopTelemetry();
      if (previous === state.profile) {
        for (const config of [state.device.configRaw, state.draft.configRaw]) config[7] &= ~8;
      }
    }
    await board.startTelemetry(target);
  }
  // The telemetry bit goes into the draft too, or it reads as an unsaved edit auto-save would undo.
  if (target === state.profile) {
    for (const config of [state.device.configRaw, state.draft.configRaw]) config[7] |= 8;
  }
  if (!state.liveOff) state.liveOff = board.onTelemetry(onTelemetry);
}

async function stopLiveIndicator() {
  if (!state.liveOff) return;
  state.liveOff();
  state.liveOff = null;
  await state.board?.stopTelemetry();
}

const SCROLLING_KEYS = new Set([
  " ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End",
]);

function suppressScrollKeys(event) {
  if (event.target.closest?.("input, select, textarea")) return;
  if (SCROLLING_KEYS.has(event.key)) event.preventDefault();
}

function bindTravelControls() {
  for (const { id, field } of TRAVEL_SLIDERS) {
    $(id).addEventListener("input", (event) => applyTravel(field, Number(event.target.value)));
  }
  $("travel-rt-both").addEventListener("input", (event) => {
    const value = Number(event.target.value);
    for (const index of state.selectedKeys) {
      state.draft.travel[index].rtPress = value;
      state.draft.travel[index].rtRelease = value;
    }
    renderTravel();
    drawRapidTrigger();
    updateWriteButton();
  });
  $("rt-enabled").addEventListener("change", (event) => {
    for (const index of state.selectedKeys) {
      const travel = state.draft.travel[index];
      if (!event.target.checked) travel.mode = 0;
      else if (travel.mode === 0) travel.mode = 1;
    }
    renderTravel();
    drawRapidTrigger();
    updateWriteButton();
  });
  $("rt-continuous").addEventListener("change", (event) => {
    for (const index of state.selectedKeys) {
      const travel = state.draft.travel[index];
      if (travel.mode !== 0) travel.mode = event.target.checked ? 2 : 1;
    }
    renderTravel();
    drawRapidTrigger();
    updateWriteButton();
  });
  $("rt-split").addEventListener("change", (event) => {
    state.rtSplit = event.target.checked;
    if (!state.rtSplit) {
      for (const index of state.selectedKeys) {
        const travel = state.draft.travel[index];
        travel.rtRelease = travel.rtPress;
      }
      drawRapidTrigger();
      updateWriteButton();
    }
    renderTravel();
  });
}

function drawRapidTrigger() {
  const mm = (hundredths) => (hundredths / 100).toFixed(2);
  for (const button of $("board").querySelectorAll(".key")) {
    const travel = state.draft?.travel[Number(button.dataset.index)];
    if (!travel) continue;
    const on = travel.mode !== 0;
    button.classList.toggle("has-rt", on);
    button.querySelector(".rt-press").textContent = on ? mm(travel.rtPress) : "";
    button.querySelector(".rt-release").textContent = on && travel.rtRelease !== travel.rtPress ? mm(travel.rtRelease) : "";
    button.querySelector(".rt-cont").hidden = !(on && travel.mode === 2);
  }
}

const ADVANCED_BANKS = Object.freeze([
  { id: "pair" },
  { id: "toggle" },
  { id: "dks" },
]);

const ADV_FEATURES = Object.freeze([
  { id: "modtap", type: 0x92, bank: "pair", keys: 1, nameKey: "adv.fModTap", descKey: "adv.dModTap",
    icon: '<rect x="3" y="5" width="12" height="12" rx="2"/><circle cx="17.5" cy="15.5" r="4"/><path d="M17.5 13.5v2l1.4 1"/>' },
  { id: "dks", type: 0x90, bank: "dks", keys: 1, nameKey: "adv.fDks", descKey: "adv.dDks",
    icon: '<path d="M5 20v-5M10 20v-9M15 20v-13M20 20v-16"/>' },
  { id: "toggle", type: 0x91, bank: "toggle", keys: 1, nameKey: "adv.fToggle", descKey: "adv.dToggle",
    icon: '<rect x="3" y="8" width="18" height="8" rx="4"/><circle cx="16.5" cy="12" r="2.2"/>' },
  // Only kept so pairs set up elsewhere hold their slot and can be removed; not offered.
  { id: "keypair", type: 0x93, bank: "pair", keys: 2, nameKey: "adv.fKeyPair", offered: false,
    icon: '<rect x="2" y="7" width="7" height="10" rx="2"/><rect x="15" y="7" width="7" height="10" rx="2"/><path d="M13 5l-2.5 7h3L11 19"/>' },
  { id: "socd", type: 0x94, bank: "pair", keys: 2, nameKey: "adv.fSocd", descKey: "adv.dSocd",
    icon: '<path d="M3 12h7M3 12l3-3M3 12l3 3M21 12h-7M21 12l-3-3M21 12l-3 3"/>' },
]);
const ADV_TYPES = new Set(ADV_FEATURES.map((feature) => feature.type));
const featureByType = (type) => ADV_FEATURES.find((feature) => feature.type === type);
const featureById = (id) => ADV_FEATURES.find((feature) => feature.id === id);

const DEFAULT_HOLD = 20;
const HOLD_MODIFIER = { type: 0x10, code1: 1, code2: 0 };
const ADV_BLANK = { type: 0, code1: 0, code2: 0 };
const ADV_UNASSIGNED = { type: 0xff, code1: 0xff, code2: 0xff };

const advEntry = ({ type, code1, code2 }) => ({ type, code1, code2, name: mappingName({ type, code1, code2 }) });
const layerLabel = (layer) => (layer === 0 ? t("layer.base") : t("layer.name", { n: layer }));
const keyLabel = (index) => KEYS.find((key) => key.index === index)?.label ?? `#${index}`;

const svgIcon = (paths) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;

function advancedBindings() {
  const bindings = [];
  state.draft.layers.forEach((mappings, layer) => {
    for (const key of KEYS) {
      const item = mappings[key.index];
      const feature = featureByType(item.type);
      if (!feature) continue;
      if (feature.keys === 2) {
        const known = bindings.find((binding) => binding.layer === layer
          && binding.feature === feature && binding.slot === item.code1
          && binding.keys.length === 1 && binding.keys[0] === item.code2);
        if (known) {
          known.keys.push(key.index);
          continue;
        }
      }
      bindings.push({ feature, layer, slot: item.code1, keys: [key.index] });
    }
  });
  return bindings;
}

function slotInUse(bank, slot) {
  return state.draft.layers.some((mappings) => KEYS.some(({ index }) => {
    const feature = featureByType(mappings[index].type);
    return feature?.bank === bank && mappings[index].code1 === slot;
  }));
}

function emptySlot(bank) {
  if (bank === "pair") return { first: advEntry(ADV_BLANK), second: advEntry(ADV_BLANK) };
  if (bank === "toggle") return advEntry(ADV_BLANK);
  return { points: [0, 0, 0, 0], actions: Array.from({ length: 4 }, () => ({ ...advEntry(ADV_BLANK), status: 0 })) };
}

function ownAction(layer, index) {
  const item = state.draft.layers[layer][index];
  return ADV_TYPES.has(item.type) ? { ...ADV_BLANK } : { type: item.type, code1: item.code1, code2: item.code2 };
}

function factoryAction(index) {
  const code = KEYS.find((key) => key.index === index)?.code;
  if (code === undefined) return null;
  if (code === FN) return { type: 0xf0, code1: 0xff, code2: 0x01 };
  if (code >= 0xe0 && code <= 0xe7) return { type: 0x10, code1: 1 << (code - 0xe0), code2: 0 };
  return { type: 0x10, code1: 0, code2: code };
}

function removeBinding(binding) {
  const { feature, layer, slot, keys } = binding;
  const bank = state.draft.advanced[feature.bank];
  const stored = bank[slot];
  const restore = (index, action) => {
    state.draft.layers[layer][index] = advEntry(action?.type ? action : ADV_UNASSIGNED);
  };
  const own = layer === 0 ? factoryAction(keys[0]) : null;
  if (feature.id === "modtap") restore(keys[0], own ?? stored.first);
  else if (feature.id === "toggle") restore(keys[0], own ?? stored);
  else if (feature.id === "dks") {
    const own = state.draft.layers[layer][keys[0]].code2;
    restore(keys[0], own ? { type: 0x10, code1: 0, code2: own } : stored.actions[0]);
  }
  else {
    const [low, high] = [...keys].sort((a, b) => a - b);
    restore(low, stored.first);
    if (high !== undefined) restore(high, stored.second);
    for (const index of keys) {
      state.draft.travel[index].mode = 0;
      state.draft.travel[index].priority = 0;
    }
  }
  if (!slotInUse(feature.bank, slot)) bank[slot] = emptySlot(feature.bank);
}

function saveAdvanced() {
  const edit = state.adv;
  const feature = featureById(edit.feature);
  const layer = edit.layer;
  const keys = [...edit.keys];

  if (edit.binding) removeBinding(edit.binding);
  for (const binding of advancedBindings()) {
    if (binding.layer === layer && binding.keys.some((index) => keys.includes(index))) removeBinding(binding);
  }

  const slot = Array.from({ length: ADVANCED_SLOTS }, (_, index) => index)
    .find((index) => !slotInUse(feature.bank, index));
  if (slot === undefined) throw new Error(t("adv.noFreeSlot"));

  const bank = state.draft.advanced[feature.bank];
  const put = (index, code2) => {
    state.draft.layers[layer][index] = advEntry({ type: feature.type, code1: slot, code2 });
  };
  if (feature.id === "modtap") {
    bank[slot] = { first: advEntry(edit.tap), second: advEntry(edit.hold) };
    put(keys[0], edit.holdTime);
  } else if (feature.id === "toggle") {
    bank[slot] = advEntry(edit.action);
    put(keys[0], 0);
  } else if (feature.id === "dks") {
    const [first, second] = edit.points.map((tenths) =>
      Math.max(1, Math.min(255, Math.round((tenths * 10) / TRAVEL_UNIT / 10))));
    bank[slot] = {
      points: [first, second, second, first],
      actions: edit.actions.map((action, index) => ({ ...advEntry(action), status: dksStatus(edit.cells[index]) })),
    };
    const own = ownAction(layer, keys[0]);
    put(keys[0], own.type === 0x10 ? own.code2 : 0);
  } else {
    const [low, high] = [...keys].sort((a, b) => a - b);
    bank[slot] = { first: advEntry(ownAction(layer, low)), second: advEntry(ownAction(layer, high)) };
    put(low, high);
    put(high, low);
    [low, high].forEach((index, order) => {
      state.draft.travel[index].mode = 1;
      state.draft.travel[index].priority = feature.id === "socd" ? order + 1 : 0;
    });
  }

  log("ok", t("adv.added", {
    feature: t(feature.nameKey), keys: keys.map(keyLabel).join(" + "), layer: layerLabel(layer),
  }));
}

function startAdvanced(feature) {
  state.adv = {
    feature: feature.id, step: "pick", keys: [], layer: state.layer, binding: null, query: "",
    slot: feature.id === "modtap" ? "hold" : feature.id === "dks" ? 0 : "action",
    tap: { ...ADV_BLANK }, hold: { ...HOLD_MODIFIER }, holdTime: DEFAULT_HOLD,
    action: { ...ADV_BLANK },
    points: [10, 30],
    actions: Array.from({ length: 4 }, () => ({ ...ADV_BLANK })),
    cells: [[7, 7, 3, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
  };
  setSelection([]);
}

function editAdvanced(binding) {
  const { feature, layer, slot, keys } = binding;
  const stored = state.draft.advanced[feature.bank][slot];
  const plain = ({ type, code1, code2 }) => ({ type, code1, code2 });
  startAdvanced(feature);
  Object.assign(state.adv, { step: "configure", keys: [...keys], layer, binding });
  if (feature.id === "modtap") {
    state.adv.tap = plain(stored.first);
    state.adv.hold = plain(stored.second);
    state.adv.holdTime = state.draft.layers[layer][keys[0]].code2 || DEFAULT_HOLD;
  } else if (feature.id === "toggle") {
    state.adv.action = plain(stored);
  } else if (feature.id === "dks") {
    state.adv.points = [stored.points[0] * TRAVEL_UNIT, stored.points[1] * TRAVEL_UNIT];
    state.adv.actions = stored.actions.map(plain);
    state.adv.cells = stored.actions.map((action) => dksCells(action.status));
  }
  state.selectedKeys = new Set(keys);
  refreshSelection();
}

function leaveAdvanced() {
  state.adv = null;
  setSelection([]);
  renderAdvanced();
}

function pickAdvancedKeys() {
  const edit = state.adv;
  if (!edit || !$("panel-advanced").classList.contains("is-active")) return;
  const feature = featureById(edit.feature);
  const picked = [...state.selectedKeys].slice(-feature.keys);
  state.selectedKeys = new Set(picked);
  const added = picked.find((index) => !edit.keys.includes(index));
  edit.keys = picked;
  if (added !== undefined && picked.length === 1 && edit.step === "pick") {
    const own = ownAction(edit.layer, added);
    edit.tap = own;
    edit.action = own;
    edit.actions[0] = own;
  }
}

function advRow(label, control) {
  const wrap = document.createElement("label");
  const caption = document.createElement("span");
  caption.textContent = label;
  wrap.append(caption, control);
  return wrap;
}

function advHeading(text) {
  const title = document.createElement("h3");
  title.textContent = text;
  return title;
}

function summariseBinding({ feature, layer, slot, keys }) {
  const stored = state.draft.advanced[feature.bank][slot];
  if (feature.id === "modtap") {
    return t("adv.sumModTap", {
      tap: mappingName(stored.first) || "—",
      hold: mappingName(stored.second) || "—",
      ms: state.draft.layers[layer][keys[0]].code2 * 10,
    });
  }
  if (feature.id === "toggle") return t("adv.sumToggle", { action: mappingName(stored) || "—" });
  if (feature.id === "dks") return stored.actions.map(mappingName).filter(Boolean).join(", ") || "—";
  return keys.map(keyLabel).join(" ↔ ");
}

const DKS_ROW = 52;
const DKS_COLUMN = 72;
const DKS_DOT = 30;
const DKS_EVENT_ICONS = [
  ["adv.dksEvent1", '<path d="M12 4v11M7 10l5 5 5-5"/>'],
  ["adv.dksEvent2", '<path d="M12 3v11M7 9l5 5 5-5M5 20h14"/>'],
  ["adv.dksEvent3", '<path d="M5 20h14M12 16V5M7 10l5-5 5 5"/>'],
  ["adv.dksEvent4", '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>'],
];

function dksEditor(edit) {
  const grid = document.createElement("div");
  grid.className = "dks";
  grid.style.setProperty("--dks-row", `${DKS_ROW}px`);
  grid.style.setProperty("--dks-column", `${DKS_COLUMN}px`);

  const cell = (className, text = "") => {
    const element = document.createElement("div");
    element.className = className;
    element.textContent = text;
    return element;
  };

  grid.append(cell("dks-caption", t("adv.dksBindings")),
    cell("dks-group is-press", t("adv.dksKeyPress")),
    cell("dks-group is-release", t("adv.dksKeyRelease")));

  grid.append(cell("dks-corner"));
  [0, 1, 1, 0].forEach((point, event) => {
    if (event >= 2) {
      grid.append(cell("dks-depth is-mirror", `${(edit.points[point] / 10).toFixed(1)} mm`));
      return;
    }
    const input = document.createElement("input");
    input.className = "value-field dks-depth";
    input.type = "text";
    input.inputMode = "decimal";
    input.value = `${(edit.points[point] / 10).toFixed(1)} mm`;
    input.title = t(point === 0 ? "adv.pointFirst" : "adv.pointSecond");
    input.addEventListener("change", () => {
      const tenths = Math.round(parseFloat(input.value.replace(",", ".")) * 10 / TRAVEL_UNIT) * TRAVEL_UNIT;
      if (Number.isFinite(tenths)) edit.points[point] = Math.max(TRAVEL_UNIT, Math.min(40, tenths));
      renderAdvanced();
    });
    input.addEventListener("keydown", (event) => { if (event.key === "Enter") input.blur(); });
    grid.append(input);
  });

  grid.append(cell("dks-corner"));
  DKS_EVENT_ICONS.forEach(([titleKey, icon], event) => {
    const glyph = cell(`dks-event${event < 2 ? " is-press" : " is-release"}`);
    glyph.innerHTML = svgIcon(icon);
    glyph.title = t(titleKey);
    grid.append(glyph);
  });

  edit.actions.forEach((action, row) => {
    const key = document.createElement("button");
    key.type = "button";
    key.className = "dks-binding";
    key.textContent = mappingName(action) || "+";
    key.classList.toggle("is-empty", !action.type);
    key.classList.toggle("is-active", edit.slot === row);
    key.title = t("adv.dksAction", { n: row + 1 });
    key.addEventListener("click", () => { edit.slot = row; renderAdvanced(); });
    grid.append(key, dksTrack(edit, row));
  });

  const hint = document.createElement("p");
  hint.className = "muted dks-hint";
  hint.textContent = t("adv.dksHint");
  grid.append(hint);
  return grid;
}

function dksTrack(edit, row) {
  const track = document.createElement("div");
  track.className = "dks-track";
  const presses = dksPresses(edit.cells[row]);
  const covered = new Set(presses.flatMap(({ start, release }) =>
    release === null ? [start] : Array.from({ length: release - start }, (_, k) => start + k)));
  const offset = (event) => `${event * DKS_COLUMN + (DKS_COLUMN - DKS_DOT) / 2}px`;
  // A hold ends where its release column begins, leaving that column's "+" free.
  const barWidth = (press) => (press.release === null ? DKS_DOT
    : (press.release - press.start) * DKS_COLUMN - (DKS_COLUMN - DKS_DOT) / 2);

  for (let event = 0; event < DKS_EVENTS; event += 1) {
    if (covered.has(event)) continue;
    const add = document.createElement("button");
    add.type = "button";
    add.className = "dks-add";
    add.style.left = offset(event);
    add.textContent = "+";
    add.title = t("adv.dksAdd");
    add.addEventListener("click", () => {
      edit.cells[row] = dksFromPresses([...presses, { start: event, release: null }]);
      renderAdvanced();
    });
    track.append(add);
  }

  presses.forEach((press, index) => {
    const bar = document.createElement("span");
    bar.className = "dks-press";
    bar.style.left = offset(press.start);
    bar.style.width = `${barWidth(press)}px`;
    bar.title = t("adv.dksPress");
    bar.addEventListener("pointerdown", (down) => {
      if (down.button !== 0) return;
      down.preventDefault();
      try { bar.setPointerCapture(down.pointerId); } catch (_) { /* not critical */ }
      const left = track.getBoundingClientRect().left;
      const next = presses[index + 1]?.start ?? DKS_EVENTS;
      let moved = false;
      let current = press;
      const move = (event) => {
        const column = Math.floor((event.clientX - left) / DKS_COLUMN);
        const release = Math.min(column + 1, next, DKS_EVENTS - 1);
        const updated = { start: press.start, release: release > press.start ? release : null };
        if (updated.release === current.release) return;
        moved = true;
        current = updated;
        edit.cells[row] = dksFromPresses([...presses.filter((_, other) => other !== index), current]);
        bar.style.width = `${barWidth(current)}px`;
      };
      const up = () => {
        bar.removeEventListener("pointermove", move);
        bar.removeEventListener("pointerup", up);
        bar.removeEventListener("pointercancel", up);
        if (!moved) edit.cells[row] = dksFromPresses(presses.filter((_, other) => other !== index));
        renderAdvanced();
      };
      bar.addEventListener("pointermove", move);
      bar.addEventListener("pointerup", up);
      bar.addEventListener("pointercancel", up);
    });
    track.append(bar);
  });
  return track;
}

function markAdvancedKeys() {
  const layer = state.draft?.layers[state.layer];
  for (const button of $("board").querySelectorAll(".key")) {
    const item = layer?.[Number(button.dataset.index)];
    button.classList.toggle("is-advanced", Boolean(item && ADV_TYPES.has(item.type)));
  }
}

function renderAdvanced() {
  markAdvancedKeys();
  const left = $("adv-left");
  const right = $("adv-right");
  const bar = $("adv-bar");
  left.replaceChildren();
  right.replaceChildren();
  bar.replaceChildren();
  const step = state.adv?.step ?? "home";
  bar.hidden = step === "home";
  $("adv-sectors").classList.toggle("is-configure", step === "configure");
  $("adv-sectors").classList.toggle("is-dks", step === "configure" && state.adv.feature === "dks");
  if (step === "home") renderAdvancedHome(left, right);
  else if (step === "pick") renderAdvancedPick(bar, left, right);
  else renderAdvancedConfigure(bar, left, right);
}

function renderAdvancedHome(left, right) {
  left.append(advHeading(t("adv.addTitle")));
  const grid = document.createElement("div");
  grid.className = "adv-features";
  for (const feature of ADV_FEATURES.filter((entry) => entry.offered !== false)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "adv-feature";
    button.innerHTML = svgIcon(feature.icon);
    const name = document.createElement("strong");
    name.textContent = t(feature.nameKey);
    const description = document.createElement("small");
    description.textContent = t(feature.descKey);
    button.append(name, description);
    button.addEventListener("click", () => { startAdvanced(feature); renderAdvanced(); });
    grid.append(button);
  }
  left.append(grid);

  right.append(advHeading(t("adv.listTitle")), advancedList(advancedBindings(), t("adv.listEmpty")));
}

function advancedList(bindings, emptyText) {
  if (!bindings.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = emptyText;
    return empty;
  }
  const list = document.createElement("ul");
  list.className = "adv-list";
  for (const binding of bindings) {
    const item = document.createElement("li");
    const icon = document.createElement("span");
    icon.className = "adv-list-icon";
    icon.innerHTML = svgIcon(binding.feature.icon);
    const text = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = `${t(binding.feature.nameKey)} · ${binding.keys.map(keyLabel).join(" + ")}`;
    const detail = document.createElement("small");
    detail.textContent = `${layerLabel(binding.layer)} · ${summariseBinding(binding)}`;
    text.append(title, detail);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-button";
    remove.title = t("adv.remove");
    remove.setAttribute("aria-label", t("adv.remove"));
    remove.innerHTML = svgIcon(TRASH_ICON);
    remove.addEventListener("click", () => {
      removeBinding(binding);
      log("ok", t("adv.removed", { feature: t(binding.feature.nameKey), keys: binding.keys.map(keyLabel).join(" + ") }));
      renderBoard();
      renderTravel();
      renderAdvanced();
      updateWriteButton();
    });
    if (binding.feature.offered === false) {
      text.title = t("adv.removeOnly");
    } else {
      text.classList.add("adv-list-open");
      text.tabIndex = 0;
      const open = () => { editAdvanced(binding); renderAdvanced(); };
      text.addEventListener("click", open);
      text.addEventListener("keydown", (event) => { if (event.key === "Enter") open(); });
    }
    item.append(icon, text, remove);
    list.append(item);
  }
  return list;
}

function advancedBar(bar, feature, buttons) {
  const title = document.createElement("h3");
  title.textContent = t(feature.nameKey);
  const actions = document.createElement("div");
  actions.className = "adv-actions";
  actions.append(...buttons);
  bar.append(title, actions);
}

function advButton(label, onClick, { primary = false, icon = null } = {}) {
  const button = document.createElement("button");
  button.type = "button";
  if (primary) button.className = "primary";
  if (icon) button.innerHTML = svgIcon(icon);
  button.append(document.createTextNode(label));
  button.addEventListener("click", onClick);
  return button;
}

const TRASH_ICON = '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>';

function renderAdvancedPick(bar, left, right) {
  const edit = state.adv;
  const feature = featureById(edit.feature);
  const next = advButton(t("adv.continue"), () => { edit.step = "configure"; renderAdvanced(); }, { primary: true });
  next.disabled = edit.keys.length < feature.keys;
  advancedBar(bar, feature, [advButton(t("common.cancel"), leaveAdvanced), next]);

  right.append(advHeading(t("adv.configuredTitle", { feature: t(feature.nameKey) })),
    advancedList(advancedBindings().filter((binding) => binding.feature === feature),
      t("adv.configuredEmpty", { feature: t(feature.nameKey) })));

  const prompt = document.createElement("p");
  prompt.className = "adv-prompt";
  prompt.textContent = t(feature.keys === 2 ? "adv.pickKeysTo" : "adv.pickKeyTo", { feature: t(feature.nameKey) });
  const description = document.createElement("p");
  description.className = "muted";
  description.textContent = t(feature.descKey);
  left.append(prompt, description, advancedKeyChips(edit, feature));
}

function advancedKeyChips(edit, feature) {
  const chips = document.createElement("div");
  chips.className = "adv-keys";
  for (let n = 0; n < feature.keys; n += 1) {
    const chip = document.createElement("div");
    chip.className = "adv-slot is-static";
    const index = edit.keys[n];
    chip.classList.toggle("is-empty", index === undefined);
    const caption = document.createElement("small");
    caption.textContent = t("adv.keyN", { n: n + 1 });
    const value = document.createElement("strong");
    value.textContent = index === undefined ? "?" : keyLabel(index);
    chip.append(caption, value);
    chips.append(chip);
  }
  return chips;
}

function advancedCatalogue() {
  const excluded = new Set(["remap.groupMacros", "remap.groupAdvanced"]);
  return [
    { titleKey: "adv.groupNone", items: [{ type: 0, code1: 0, code2: 0, label: t("adv.unassigned") }] },
    ...remapCatalogue().filter((group) => !excluded.has(group.titleKey)),
  ];
}

function slotAccess(edit, slot) {
  if (slot === "hold" || slot === "tap" || slot === "action") {
    return { get: () => edit[slot], set: (value) => { edit[slot] = value; } };
  }
  return { get: () => edit.actions[slot], set: (value) => { edit.actions[slot] = value; } };
}

function holdTimeOptions() {
  return Array.from({ length: 20 }, (_, index) => {
    const ms = (index + 1) * 50;
    return { value: String(ms / 10), name: t("adv.holdMs", { n: ms }) };
  });
}

function renderAdvancedConfigure(bar, left, right) {
  const edit = state.adv;
  const feature = featureById(edit.feature);

  const done = () => {
    try {
      saveAdvanced();
    } catch (error) {
      showError(error.message);
      return;
    }
    state.adv = null;
    setSelection([]);
    renderBoard();
    renderTravel();
    renderAdvanced();
    updateWriteButton();
  };
  const remove = () => {
    if (edit.binding) {
      removeBinding(edit.binding);
      log("ok", t("adv.removed", { feature: t(feature.nameKey), keys: edit.binding.keys.map(keyLabel).join(" + ") }));
      renderBoard();
      renderTravel();
      updateWriteButton();
    }
    leaveAdvanced();
  };
  const doneButton = advButton(t("adv.done"), done, { primary: true });
  doneButton.disabled = edit.keys.length < feature.keys;
  advancedBar(bar, feature, [advButton(t("adv.delete"), remove, { icon: TRASH_ICON }), doneButton]);

  const pairs = feature.keys === 2;
  if (pairs) {
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = t("adv.pairNote");
    left.append(note);
  } else {
    const search = document.createElement("input");
    search.type = "search";
    search.className = "search";
    search.placeholder = t("remap.search");
    search.value = edit.query;
    const catalogue = document.createElement("div");
    const access = slotAccess(edit, edit.slot);
    const draw = () => renderCatalogue(catalogue, advancedCatalogue(), {
      query: edit.query.trim().toLowerCase(),
      current: access.get(),
      pick: (item) => {
        access.set({ type: item.type, code1: item.code1, code2: item.code2 });
        renderAdvanced();
      },
      rerender: draw,
      emptyText: t("remap.nothingFound", { query: edit.query.trim() }),
    });
    search.addEventListener("input", () => {
      edit.query = search.value;
      draw();
    });
    left.append(search, catalogue);
    draw();
  }

  const description = document.createElement("p");
  description.className = "muted";
  description.textContent = t(feature.descKey);
  const where = document.createElement("p");
  where.className = "adv-where";
  where.textContent = t("adv.keysOn", { keys: edit.keys.map(keyLabel).join(" + "), layer: layerLabel(edit.layer) });
  right.append(description, where);

  const slotButton = (slot, caption) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "adv-slot";
    const action = slotAccess(edit, slot).get();
    button.classList.toggle("is-active", edit.slot === slot);
    button.classList.toggle("is-empty", !action.type);
    const small = document.createElement("small");
    small.textContent = caption;
    const strong = document.createElement("strong");
    strong.textContent = mappingName(action) || "—";
    button.append(small, strong);
    button.addEventListener("click", () => { edit.slot = slot; renderAdvanced(); });
    return button;
  };

  if (feature.id === "modtap") {
    const slots = document.createElement("div");
    slots.className = "adv-keys";
    slots.append(slotButton("hold", t("adv.hold")), slotButton("tap", t("adv.tap")));
    const hold = document.createElement("select");
    fillSelect(hold, holdTimeOptions(), String(edit.holdTime));
    hold.addEventListener("change", (event) => { edit.holdTime = Number(event.target.value); });
    right.append(slots, advRow(t("adv.holdTime"), hold));
  } else if (feature.id === "toggle") {
    const slots = document.createElement("div");
    slots.className = "adv-keys";
    slots.append(slotButton("action", t("adv.toggleAction")));
    right.append(slots);
  } else if (feature.id === "dks") {
    right.append(dksEditor(edit));
  } else {
    right.append(advancedKeyChips(edit, feature));
  }
}

const hidName = (hid) => (hid >= 0xe0 && hid <= 0xe7 ? MODIFIERS[hid - 0xe0] : HID_KEYS[hid] || `#${hid}`);
const targetName = ({ kind, code }) =>
  macroTargets().find((target) => target.value === `${kind}:${code}`)?.name ?? `${kind}:${code}`;
const macroStepsUsed = () => state.draft.macros.reduce((sum, steps) => sum + (steps?.length ?? 0), 0);

const MACRO_TYPE = 0x70;
const MAX_REPEATS = 10;

function markMacroKeys() {
  const layer = state.draft?.layers[state.layer];
  for (const button of $("board").querySelectorAll(".key")) {
    const item = layer?.[Number(button.dataset.index)];
    const macro = item?.type === MACRO_TYPE;
    button.classList.toggle("is-macro", macro);
    button.classList.toggle("is-macro-current", macro && item.code1 === state.macroSlot);
  }
}

function macroKeys(slot) {
  const found = [];
  state.draft.layers.forEach((mappings, layer) => {
    for (const key of KEYS) {
      const item = mappings[key.index];
      if (item.type === MACRO_TYPE && item.code1 === slot) found.push({ layer, index: key.index, repeats: item.code2 });
    }
  });
  return found;
}

function takeMacroOff(layer, index) {
  state.draft.layers[layer][index] = advEntry((layer === 0 ? factoryAction(index) : null) ?? ADV_UNASSIGNED);
}

function macroKeysChanged() {
  renderBoard();
  renderTravel();
  renderMacros();
  updateWriteButton();
}

function toggleMacroOnKey(index) {
  const layer = state.layer;
  const slot = state.macroSlot;
  const current = state.draft.layers[layer][index];
  const where = { macro: t("macros.slotName", { n: slot + 1 }), key: keyLabel(index), layer: layerLabel(layer) };
  if (current.type === MACRO_TYPE && current.code1 === slot) {
    takeMacroOff(layer, index);
    log("ok", t("macros.takenOff", where));
  } else {
    for (const binding of advancedBindings()) {
      if (binding.layer === layer && binding.keys.includes(index)) removeBinding(binding);
    }
    state.draft.layers[layer][index] = advEntry({ type: MACRO_TYPE, code1: slot, code2: state.macroRepeats });
    log("ok", t("macros.putOn", where));
  }
  macroKeysChanged();
}

function renderMacroKeys() {
  const box = $("macro-keys");
  box.replaceChildren();
  const slot = state.macroSlot;

  const hint = document.createElement("p");
  hint.className = "macro-keys-hint";
  hint.textContent = t("macros.clickKey", { macro: t("macros.slotName", { n: slot + 1 }) });

  const settings = document.createElement("div");
  settings.className = "macro-keys-settings";
  const layers = Array.from({ length: LAYERS_PER_PROFILE }, (_, layer) => ({ value: layer, name: layerLabel(layer) }));
  const layer = document.createElement("select");
  fillSelect(layer, layers, state.layer);
  layer.addEventListener("change", () => {
    $("layer").value = layer.value;
    $("layer").dispatchEvent(new Event("change"));
    renderMacros();
  });
  const repeats = document.createElement("select");
  const counts = Array.from({ length: MAX_REPEATS }, (_, n) => ({ value: n + 1, name: String(n + 1) }));
  fillSelect(repeats, counts, state.macroRepeats);
  repeats.addEventListener("change", () => { state.macroRepeats = Number(repeats.value); });
  const field = (text, control) => {
    const wrap = document.createElement("label");
    const caption = document.createElement("span");
    caption.textContent = text;
    wrap.append(caption, control);
    return wrap;
  };
  settings.append(field(t("macros.onLayer"), layer), field(t("macros.repeatTimes"), repeats));

  const placed = macroKeys(slot);
  const chips = document.createElement("div");
  chips.className = "macro-key-chips";
  if (!placed.length) {
    const none = document.createElement("span");
    none.className = "muted";
    none.textContent = t("macros.unassigned");
    chips.append(none);
  }
  for (const { layer: on, index, repeats: count } of placed) {
    const chip = document.createElement("span");
    chip.className = "macro-key-chip";
    chip.classList.toggle("is-other-layer", on !== state.layer);
    const name = document.createElement("strong");
    name.textContent = keyLabel(index);
    const where = document.createElement("small");
    where.textContent = layerLabel(on);
    const times = document.createElement("select");
    fillSelect(times, counts.map((entry) => ({ ...entry, name: `×${entry.value}` })), count);
    if (!counts.some((entry) => entry.value === count)) {
      times.append(new Option(`×${count}`, String(count), true, true));
    }
    times.title = t("macros.repeatTimes");
    times.addEventListener("change", () => {
      state.draft.layers[on][index] = advEntry({ type: MACRO_TYPE, code1: slot, code2: Number(times.value) });
      macroKeysChanged();
    });
    const remove = macroButton("✕", () => {
      takeMacroOff(on, index);
      log("ok", t("macros.takenOff", { macro: t("macros.slotName", { n: slot + 1 }), key: keyLabel(index), layer: layerLabel(on) }));
      macroKeysChanged();
    });
    remove.title = t("macros.takeOff");
    chip.append(name, where, times, remove);
    chips.append(chip);
  }
  box.append(hint, settings, chips);
}

function addMacroSteps(steps) {
  if (macroStepsUsed() + steps.length > MACRO_MAX_STEPS) {
    showError(t("macros.full", { max: MACRO_MAX_STEPS }));
    return false;
  }
  state.draft.macros[state.macroSlot].push(...steps);
  renderMacros();
  updateWriteButton();
  return true;
}

function macroButton(text, onClick, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  if (className) button.className = className;
  button.addEventListener("click", onClick);
  return button;
}

function renderMacros() {
  const list = $("macro-slots");
  list.replaceChildren();

  for (let slot = 0; slot < MACRO_SLOTS; slot += 1) {
    const steps = state.draft.macros[slot] ?? [];
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.classList.toggle("is-active", slot === state.macroSlot);

    const name = document.createElement("span");
    name.textContent = t("macros.slotName", { n: slot + 1 });
    const count = document.createElement("small");
    count.textContent = steps.length ? t("macros.steps", { n: steps.length }) : t("macros.empty");
    const keys = [...new Set(macroKeys(slot).map(({ index }) => keyLabel(index)))];
    if (keys.length) count.textContent += ` · ${keys.join(", ")}`;

    button.append(name, count);
    button.addEventListener("click", () => {
      stopMacroCapture();
      state.macroSlot = slot;
      renderMacros();
    });
    item.append(button);
    list.append(item);
  }

  const slot = state.macroSlot;
  const steps = state.draft.macros[slot] ?? [];
  const recording = state.recording;
  $("macro-title").textContent = t("macros.slotName", { n: slot + 1 });
  renderMacroKeys();
  markMacroKeys();
  $("macro-record").textContent = recording ? t("macros.stop") : t("macros.record");
  $("macro-record").classList.toggle("is-recording", Boolean(recording));
  for (const id of ["macro-add-key", "macro-add-text", "macro-add-mouse"]) {
    $(id).disabled = Boolean(recording);
  }
  $("macro-add-pause").disabled = Boolean(recording) || !steps.length;
  $("macro-add-key").classList.toggle("is-active", state.macroPanel === "key");
  $("macro-add-text").classList.toggle("is-active", state.macroPanel === "text");
  $("macro-clear").disabled = !steps.length || Boolean(recording);

  renderMacroPanel();
  renderMacroSteps(recording ? [...steps, ...recordedSteps(recording.events, macroRecordOptions())] : steps,
    { live: Boolean(recording) });
  renderMacroFooter(steps);
}

const macroRecordOptions = () => ({ recordDelays: state.macroRecordDelays, delay: state.macroDelay });

function renderMacroPanel() {
  const panel = $("macro-panel");
  panel.replaceChildren();
  panel.className = "";
  const recording = state.recording;

  if (recording) {
    panel.className = "macro-banner is-recording";
    const dot = document.createElement("span");
    dot.className = "rec-dot";
    const text = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = t("macros.recordingTitle");
    const detail = document.createElement("small");
    detail.id = "macro-rec-status";
    detail.textContent = recordingStatus();
    text.append(title, detail);
    panel.append(dot, text, macroButton(t("macros.stop"), toggleRecording, "primary"));
    return;
  }

  if (state.macroPanel === "key") {
    panel.className = "macro-banner";
    const text = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = t("macros.keyPrompt");
    const held = document.createElement("small");
    held.id = "macro-held";
    held.textContent = state.macroCapture?.order.length
      ? state.macroCapture.order.map(hidName).join(" + ")
      : t("macros.keyPromptHint");
    text.append(title, held);

    const pick = document.createElement("select");
    fillSelect(pick, macroTargets(), "2:4");
    const add = macroButton(t("macros.addThis"), () => {
      const [kind, code] = pick.value.split(":").map(Number);
      if (addMacroSteps(tapSteps({ kind, code }, state.macroDelay))) closeMacroPanel();
    });
    const or = document.createElement("span");
    or.className = "muted";
    or.textContent = t("macros.orPick");
    panel.append(text, or, pick, add, macroButton(t("common.cancel"), closeMacroPanel));
    return;
  }

  if (state.macroPanel === "text") {
    panel.className = "macro-banner is-column";
    const input = document.createElement("textarea");
    input.rows = 2;
    input.placeholder = t("macros.textPlaceholder");
    input.value = state.macroText ?? "";
    const note = document.createElement("small");
    note.className = "muted";
    note.textContent = t("macros.textHint");
    const add = macroButton(t("macros.addThis"), () => {
      const { steps, skipped } = textSteps(input.value, state.macroDelay);
      if (skipped.length) showError(t("macros.textSkipped", { chars: skipped.join(" ") }));
      if (!steps.length) return;
      if (addMacroSteps(steps)) {
        state.macroText = "";
        closeMacroPanel();
      }
    }, "primary");
    input.addEventListener("input", () => { state.macroText = input.value; });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) add.click();
    });
    const actions = document.createElement("div");
    actions.className = "macro-banner-actions";
    actions.append(note, add, macroButton(t("common.cancel"), closeMacroPanel));
    panel.append(input, actions);
    queueMicrotask(() => input.focus());
  }
}

function recordingStatus() {
  const recording = state.recording;
  const seconds = ((performance.now() - recording.started) / 1000).toFixed(1);
  return t("macros.recordingStatus", { n: recording.events.length, s: seconds });
}

const PAUSE_BLOCK_MS = 100;

function renderMacroSteps(steps, { live = false } = {}) {
  const body = $("macro-body");
  body.replaceChildren();

  if (!steps.length) {
    const empty = document.createElement("div");
    empty.className = "macro-empty";
    const title = document.createElement("strong");
    title.textContent = live ? t("macros.waitingKeys") : t("macros.noSteps");
    const hint = document.createElement("p");
    hint.className = "muted";
    hint.textContent = live ? t("macros.waitingKeysHint") : t("macros.noStepsHint");
    empty.append(title, hint);
    body.append(empty);
    return;
  }

  const stuck = live ? [] : stuckTargets(steps);
  if (stuck.length) {
    const warning = document.createElement("p");
    warning.className = "warning";
    warning.append(document.createTextNode(t("macros.stuck", { keys: stuck.map(targetName).join(", ") })),
      document.createElement("br"),
      macroButton(t("macros.releaseAtEnd"), () => addMacroSteps(releaseSteps(steps, state.macroDelay))));
    body.append(warning);
  }

  const items = macroItems(steps);
  const commit = () => {
    state.draft.macros[state.macroSlot] = stepsFromItems(items);
    renderMacros();
    updateWriteButton();
  };
  const moveTo = (from, to) => {
    const moved = moveItem(items, from, to);
    if (from === to) return false;
    if (!moved) {
      showError(t("macros.pauseFirst"));
      return false;
    }
    items.splice(0, items.length, ...moved);
    commit();
    return true;
  };
  const rowActions = (index) => {
    const actions = document.createElement("span");
    actions.className = "macro-row-actions";
    const remove = macroButton("✕", () => {
      items.splice(index, 1);
      commit();
    });
    remove.title = t("macros.delete");
    remove.disabled = live;
    actions.append(remove);
    return actions;
  };

  const list = document.createElement("ol");
  list.className = "macro-steps";
  const targets = macroTargets();
  let number = 0;

  const grip = (row, index) => {
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "macro-grip";
    handle.textContent = "⠿";
    handle.title = t("macros.drag");
    handle.setAttribute("aria-label", t("macros.drag"));
    handle.disabled = live;
    handle.addEventListener("pointerdown", (down) => dragMacroRow(down, list, row, index, moveTo));
    handle.addEventListener("keydown", (event) => {
      const offset = { ArrowUp: -1, ArrowDown: 1 }[event.key];
      if (!offset) return;
      event.preventDefault();
      if (moveTo(index, index + offset)) $("macro-body").querySelectorAll(".macro-grip")[index + offset]?.focus();
    });
    return handle;
  };

  items.forEach((item, index) => {
    const row = document.createElement("li");

    if (item.type === "pause") {
      row.className = "is-pause";
      const icon = document.createElement("span");
      icon.className = "macro-n";
      icon.textContent = "⏱";
      const wait = document.createElement("label");
      wait.className = "macro-wait";
      const text = document.createElement("span");
      text.textContent = t("macros.pauseBlock");
      const field = document.createElement("input");
      field.type = "number";
      field.min = "1";
      field.max = String(MAX_DELAY);
      field.value = String(item.ms);
      field.disabled = live;
      field.addEventListener("change", () => {
        item.ms = Math.max(0, Math.min(MAX_DELAY, Math.round(Number(field.value) || 0)));
        if (!item.ms) items.splice(index, 1);
        commit();
      });
      const unit = document.createElement("span");
      unit.textContent = t("macros.ms");
      wait.append(text, field, unit);
      row.append(grip(row, index), icon, wait, rowActions(index));
      list.append(row);
      return;
    }

    number += 1;
    row.classList.toggle("is-release", !item.pressed);
    const n = document.createElement("span");
    n.className = "macro-n";
    n.textContent = String(number);

    const direction = macroButton(item.pressed ? t("macros.pressArrow") : t("macros.releaseArrow"), () => {
      item.pressed = !item.pressed;
      commit();
    }, `macro-dir${item.pressed ? " is-press" : ""}`);
    direction.title = t("macros.toggleDir");
    direction.disabled = live;

    const target = document.createElement("select");
    fillSelect(target, targets, `${item.kind}:${item.code}`);
    target.disabled = live;
    target.addEventListener("change", () => {
      [item.kind, item.code] = target.value.split(":").map(Number);
      commit();
    });

    const addPause = macroButton(t("macros.addPauseHere"), () => {
      items.splice(index + 1, 0, { type: "pause", ms: PAUSE_BLOCK_MS });
      commit();
    }, "macro-add-pause");
    addPause.title = t("macros.addPauseHereTitle");
    // visibility, not hidden: the button keeps its room so the rows stay aligned.
    if (live || items[index + 1]?.type === "pause") addPause.style.visibility = "hidden";

    row.append(grip(row, index), n, direction, target, addPause, rowActions(index));
    list.append(row);
  });
  body.append(list);
  if (live) list.lastElementChild?.scrollIntoView({ block: "nearest" });
}

function dragMacroRow(down, list, row, from, moveTo) {
  if (down.button !== 0) return;
  down.preventDefault();
  const handle = down.currentTarget;
  try { handle.setPointerCapture(down.pointerId); } catch (_) { /* not critical */ }

  const rows = [...list.children];
  const box = list.getBoundingClientRect();
  const at = (clientY) => clientY - box.top + list.scrollTop;
  const middles = rows.map((other) => {
    const rect = other.getBoundingClientRect();
    return at(rect.top) + rect.height / 2;
  });
  const gap = parseFloat(getComputedStyle(list).rowGap) || 0;
  const span = row.getBoundingClientRect().height + gap;
  const start = at(down.clientY);
  let to = from;
  let pointerY = down.clientY;

  row.classList.add("is-dragging");
  list.classList.add("is-sorting");

  const place = () => {
    const y = at(pointerY);
    row.style.transform = `translateY(${y - start}px)`;
    to = middles.filter((middle, index) => index !== from && middle < y).length;
    rows.forEach((other, index) => {
      if (other === row) return;
      const shift = from < to && index > from && index <= to ? -span
        : from > to && index >= to && index < from ? span : 0;
      other.style.transform = shift ? `translateY(${shift}px)` : "";
    });
  };
  const scroller = setInterval(() => {
    const edge = 28;
    const step = pointerY < box.top + edge ? -8 : pointerY > box.bottom - edge ? 8 : 0;
    if (!step) return;
    list.scrollTop += step;
    place();
  }, 16);

  const move = (event) => {
    pointerY = event.clientY;
    place();
  };
  const up = () => {
    clearInterval(scroller);
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", up);
    handle.removeEventListener("pointercancel", up);
    for (const other of rows) other.style.transform = "";
    row.classList.remove("is-dragging");
    list.classList.remove("is-sorting");
    moveTo(from, to);
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", up);
  handle.addEventListener("pointercancel", up);
}

function renderMacroFooter(steps) {
  const footer = $("macro-footer");
  footer.replaceChildren();

  const totals = document.createElement("p");
  totals.className = "muted";
  totals.textContent = t("macros.totals", {
    n: steps.length, ms: macroDuration(steps), used: macroStepsUsed(), max: MACRO_MAX_STEPS,
  });

  const pause = document.createElement("div");
  pause.className = "macro-pause";
  const label = document.createElement("span");
  label.textContent = t("macros.pause");
  const field = document.createElement("input");
  field.type = "number";
  field.min = "0";
  field.max = String(MAX_DELAY);
  field.value = String(state.macroDelay);
  field.addEventListener("change", () => {
    state.macroDelay = Math.max(0, Math.min(MAX_DELAY, Math.round(Number(field.value) || 0)));
    field.value = String(state.macroDelay);
  });
  const unit = document.createElement("span");
  unit.textContent = t("macros.ms");
  const apply = macroButton(t("macros.applyAll"), () => {
    state.draft.macros[state.macroSlot] = withDelay(steps, state.macroDelay);
    renderMacros();
    updateWriteButton();
  });
  apply.disabled = !steps.length || Boolean(state.recording);

  const real = document.createElement("label");
  real.className = "check";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = state.macroRecordDelays;
  box.disabled = Boolean(state.recording);
  box.addEventListener("change", () => { state.macroRecordDelays = box.checked; });
  const realText = document.createElement("span");
  realText.textContent = t("macros.realPauses");
  real.append(box, realText);

  pause.append(label, field, unit, apply, real);
  footer.append(pause, totals);
}

function closeMacroPanel() {
  stopMacroCapture();
  state.macroPanel = null;
  renderMacros();
}

function stopMacroCapture() {
  if (state.recording) toggleRecording();
  if (state.macroCapture) {
    window.removeEventListener("keydown", state.macroCapture.onKeyDown, true);
    window.removeEventListener("keyup", state.macroCapture.onKeyUp, true);
    state.macroCapture = null;
  }
}

function openKeyEntry() {
  if (state.macroPanel === "key") {
    closeMacroPanel();
    return;
  }
  stopMacroCapture();
  state.macroPanel = "key";
  const order = [];
  const held = new Set();
  const onKeyDown = (event) => {
    const hid = eventCodeToHid(event.code);
    if (hid === null || event.target instanceof HTMLSelectElement) return;
    event.preventDefault();
    event.stopPropagation();
    if (!held.has(hid)) {
      held.add(hid);
      if (!order.includes(hid)) order.push(hid);
    }
    const shown = $("macro-held");
    if (shown) shown.textContent = order.map(hidName).join(" + ");
  };
  const onKeyUp = (event) => {
    const hid = eventCodeToHid(event.code);
    if (hid === null || !held.has(hid)) return;
    event.preventDefault();
    event.stopPropagation();
    held.delete(hid);
    if (held.size) return;
    const steps = comboSteps(order, state.macroDelay);
    order.length = 0;
    if (addMacroSteps(steps)) closeMacroPanel();
  };
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  state.macroCapture = { order, onKeyDown, onKeyUp };
  document.activeElement?.blur();
  renderMacros();
}

function openTextEntry() {
  const open = state.macroPanel !== "text";
  closeMacroPanel();
  if (!open) return;
  state.macroPanel = "text";
  renderMacros();
}

function toggleRecording() {
  if (state.recording) {
    const { events, onKeyDown, onKeyUp, timer } = state.recording;
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
    clearInterval(timer);
    state.recording = null;
    const steps = recordedSteps(events, macroRecordOptions());
    state.draft.macros[state.macroSlot].push(...steps);
    if (steps.length) log("ok", t("macros.recorded", { n: steps.length, slot: state.macroSlot + 1 }));
    renderMacros();
    updateWriteButton();
    return;
  }

  closeMacroPanel();
  const room = MACRO_MAX_STEPS - macroStepsUsed();
  if (room <= 0) {
    showError(t("macros.full", { max: MACRO_MAX_STEPS }));
    return;
  }
  const events = [];
  const capture = (pressed) => (event) => {
    const code = eventCodeToHid(event.code);
    if (code === null) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat || events.length >= room) return;
    events.push({ pressed, code, at: performance.now() });
    renderMacros();
  };
  const onKeyDown = capture(true);
  const onKeyUp = capture(false);
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  const timer = setInterval(() => {
    const status = $("macro-rec-status");
    if (status && state.recording) status.textContent = recordingStatus();
  }, 100);
  state.recording = { events, onKeyDown, onKeyUp, timer, started: performance.now() };
  document.activeElement?.blur();
  renderMacros();
}

const TESTER_LIFETIME = 3000;
const TESTER_MAX_ENTRIES = 12;
const MOUSE_NAMES = ["tester.mouseLeft", "tester.mouseMiddle", "tester.mouseRight", "tester.mouseBack", "tester.mouseForward"];

function testerKeyName(event) {
  const hid = eventCodeToHid(event.code);
  if (hid !== null && hid >= 0xe0 && hid <= 0xe7) return MODIFIERS[hid - 0xe0];
  if (hid !== null && HID_KEYS[hid]) return HID_KEYS[hid];
  return event.code || event.key;
}

function measureFire(event, show) {
  const hid = eventCodeToHid(event.code);
  if (hid === null) return;
  const entry = hid >= 0xe0 && hid <= 0xe7
    ? { type: 0x10, code1: 1 << (hid - 0xe0), code2: 0 }
    : { type: 0x10, code1: 0, code2: hid };
  const key = entryKey(entry);
  const before = lastTelemetry.get(key);
  if (!before || performance.now() - before.time > 1000) return;
  const pending = {
    key, time: event.timeStamp, before,
    done: (travel) => show(t("tester.firedAt", { mm: (travel * TELEMETRY_MM_PER_UNIT).toFixed(2) })),
  };
  pendingFires.push(pending);
  setTimeout(() => {
    const index = pendingFires.indexOf(pending);
    if (index < 0) return;
    pendingFires.splice(index, 1);
    pending.done(before.travel);
  }, 200);
}

function bindKeyTester() {
  const box = $("key-tester");
  const held = new Map();

  const typing = () => Boolean(document.activeElement?.closest?.("input, select, textarea, [contenteditable]"));
  const visible = () => !document.querySelector(".board-wrap").hidden && !$("workspace").hidden;
  const listening = () => visible() && !document.querySelector("dialog[open]") && !typing();

  const status = () => {
    const paused = !listening();
    box.classList.toggle("is-paused", paused);
    $("tester-status").textContent = t(paused ? "tester.paused" : "tester.active");
  };
  const showHeld = () => {
    $("tester-held").replaceChildren(...[...held.values()].map((name) => {
      const chip = document.createElement("span");
      chip.className = "tester-chip";
      chip.textContent = name;
      return chip;
    }));
  };
  const add = (title, detail) => {
    const item = document.createElement("li");
    const main = document.createElement("strong");
    main.textContent = title;
    const small = document.createElement("small");
    small.textContent = detail;
    item.append(main, small);
    $("tester-log").prepend(item);
    while ($("tester-log").children.length > TESTER_MAX_ENTRIES) $("tester-log").lastChild.remove();
    setTimeout(() => item.remove(), TESTER_LIFETIME);
    return small;
  };
  const release = () => {
    held.clear();
    showHeld();
  };

  window.addEventListener("keydown", (event) => {
    if (!listening()) {
      status();
      return;
    }
    const name = testerKeyName(event);
    held.set(event.code || event.key, name);
    showHeld();
    if (event.repeat) return;
    const combo = [...held.values()];
    const flags = [[event.metaKey, "Win"], [event.altKey, "Alt"], [event.shiftKey, "Shift"], [event.ctrlKey, "Ctrl"]];
    for (const [on, modifier] of flags) {
      if (on && !combo.some((entry) => entry.endsWith(modifier))) combo.unshift(modifier);
    }
    const small = add(combo.join(" + "), "");
    measureFire(event, (fired) => { small.textContent = fired; });
  });
  window.addEventListener("keyup", (event) => {
    held.delete(event.code || event.key);
    showHeld();
  });
  window.addEventListener("blur", release);
  document.addEventListener("focusin", status);
  document.addEventListener("focusout", () => setTimeout(status));
  new MutationObserver(status).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["open", "hidden"] });

  box.addEventListener("mousedown", (event) => {
    event.preventDefault();
    add(t(MOUSE_NAMES[event.button] ?? "tester.mouseOther", { n: event.button }), t("tester.mouseDetail"));
  });
  box.addEventListener("contextmenu", (event) => event.preventDefault());
  let lastWheel = 0;
  box.addEventListener("wheel", (event) => {
    event.preventDefault();
    if (event.timeStamp - lastWheel < 150) return;  // one entry per notch, not per pixel
    lastWheel = event.timeStamp;
    add(t(event.deltaY > 0 ? "tester.wheelDown" : "tester.wheelUp"), t("tester.mouseDetail"));
  }, { passive: false });

  status();
}

function bindSetting(id, path, transform = (element) => element.value) {
  $(id).addEventListener("input", (event) => {
    const value = transform(event.target);
    const keys = path.split(".");
    let target = state.draft.settings;
    while (keys.length > 1) target = target[keys.shift()];
    target[keys[0]] = value;
    renderLighting();
    updateWriteButton();
  });
}

function bindAll() {
  const number = (element) => Number(element.value);
  const checked = (element) => element.checked;

  bindSetting("light-effect", "light.effect", number);
  bindSetting("light-brightness", "light.brightness", number);
  bindSetting("light-speed", "light.speed", number);
  bindSetting("light-color", "light.color");
  bindSetting("light-multicolor", "light.multicolor", checked);
  bindSetting("indicator-effect", "indicator.effect", number);
  bindSetting("indicator-brightness", "indicator.brightness", number);
  $("key-color").addEventListener("input", (event) => applyKeyColor(event.target.value));

  bindSetting("report-rate", "reportRate", number);
  bindSetting("tick-rate", "tickRate", number);
  bindSetting("debounce", "debounce", number);
  bindSetting("lock-win", "lockWin", checked);
  bindSetting("lock-alttab", "lockAltTab", checked);
  bindSetting("lock-altf4", "lockAltF4", checked);
  bindSetting("stability", "stabilityMode", checked);

  $("light-off").addEventListener("click", () => {
    state.draft.settings.light.effect = 255;
    renderLighting();
    updateWriteButton();
  });
  $("indicator-off").addEventListener("click", () => {
    state.draft.settings.indicator.brightness = 0;
    renderLighting();
    updateWriteButton();
  });

  // Not `connect` itself: the click event would arrive as the `board` argument.
  $("connect").addEventListener("click", () => connect());
  $("disconnect").addEventListener("click", disconnect);
  $("reload").addEventListener("click", () => reload().catch((error) => {
    log("error", error.message);
    showError(error.message);
  }));
  $("export").addEventListener("click", exportJson);
  $("remap-search").addEventListener("input", renderRemap);
  $("import").addEventListener("click", () => $("import-file").click());
  $("import-file").addEventListener("change", (event) => {
    const [file] = event.target.files ?? [];
    event.target.value = "";  // so the same file can be picked again
    if (file) importJson(file).catch((error) => { log("error", error.message); showError(error.message); });
  });
  $("copy").addEventListener("click", () => copySettings().catch((error) => {
    log("error", error.message);
    showError(error.message);
  }));
  $("restore").addEventListener("click", () => restoreBackup().catch((error) => {
    log("error", error.message);
    showError(error.message);
  }));
  $("auto-write").addEventListener("change", async (event) => {
    if (event.target.checked && !await acceptDisclaimer()) event.target.checked = false;
    state.autoWrite = event.target.checked;
    try { localStorage.setItem(AUTO_WRITE_KEY, String(state.autoWrite)); } catch (_) { /* not critical */ }
    updateAutoWriteMode();
    if (state.autoWrite) scheduleAutoWrite();
    else clearTimeout(autoWriteTimer);
  });
  $("auto-write-row").title = t("toolbar.autoWriteHint");
  $("write").addEventListener("click", () => {
    clearTimeout(autoWriteTimer);
    writeChanges().catch((error) => {
      log("error", error.message);
      showError(error.message);
    });
  });

  $("profile").addEventListener("change", async (event) => {
    const wanted = Number(event.target.value);
    const previous = state.profile;
    try {
      state.profile = wanted;
      await reload();
    } catch (error) {
      state.profile = previous;
      $("profile").value = String(previous);
      const message = t("error.readFailed", { n: wanted + 1, message: error.message });
      log("error", message);
      showError(message);
    }
  });
  $("layer").addEventListener("change", (event) => {
    state.layer = Number(event.target.value);
    renderBoard();
  });

  for (const item of document.querySelectorAll(".nav-item")) {
    item.addEventListener("click", () => {
      if (!item.classList.contains("is-active")) {
        if (state.adv) {
          state.adv = null;
          renderAdvanced();
        }
        if (state.selectedKeys.size) setSelection([]);
        if (state.recording || state.macroCapture) {
          stopMacroCapture();
          state.macroPanel = null;
          renderMacros();
        }
      }
      document.querySelectorAll(".nav-item").forEach((entry) => {
        entry.classList.toggle("is-active", entry === item);
      });
      document.querySelectorAll(".panel").forEach((panel) => {
        panel.classList.toggle("is-active", panel.id === item.dataset.panel);
      });
      document.querySelector(".board-wrap").hidden = !item.dataset.board;
      $("board").classList.toggle("shows-colors", Boolean(item.dataset.colors));
      $("board").classList.toggle("shows-slot", Boolean(item.dataset.slot));
      $("board").classList.toggle("shows-macros", Boolean(item.dataset.macros));
      $("board-hint").hidden = Boolean(item.dataset.macros);
      $("board").classList.toggle("shows-actuation", Boolean(item.dataset.actuation));
      $("board").classList.toggle("shows-rt", Boolean(item.dataset.rt));
      document.querySelector(".selection-bar").hidden = !item.dataset.select;
    });
  }

  $("select-all").addEventListener("click", () => setSelection(KEYS.map((key) => key.index)));
  $("select-none").addEventListener("click", () => setSelection([]));
  bindBrush();
  bindKeyTester();
  window.addEventListener("keydown", suppressScrollKeys);
  bindInteractionTracking();
  for (const slider of document.querySelectorAll('input[type="range"]')) {
    makeFineSlider(slider);
    const field = $(`${slider.id}-value`);
    if (field) makeValueField(field, slider);
  }
  bindTravelControls();
  $("macro-record").addEventListener("click", toggleRecording);
  $("macro-add-key").addEventListener("click", openKeyEntry);
  $("macro-add-text").addEventListener("click", openTextEntry);
  $("macro-add-pause").addEventListener("click", () => {
    closeMacroPanel();
    const steps = state.draft.macros[state.macroSlot];
    if (!steps.length) return;
    steps[steps.length - 1].delay = Math.min(MAX_DELAY, steps[steps.length - 1].delay + PAUSE_BLOCK_MS);
    renderMacros();
    updateWriteButton();
  });
  $("macro-add-mouse").addEventListener("click", () => {
    closeMacroPanel();
    addMacroSteps(tapSteps({ kind: MACRO_KIND.mouse, code: 1 }, state.macroDelay));
  });
  $("macro-clear").addEventListener("click", () => {
    closeMacroPanel();
    state.draft.macros[state.macroSlot] = [];
    renderMacros();
    updateWriteButton();
  });

  fillProfileAndLayerSelects();
  fillSelect($("locale"), locales(), getLocale());
  $("locale").addEventListener("change", (event) => changeLocale(event.target.value));
}

function tableHead(...titles) {
  const head = document.createElement("thead");
  const row = document.createElement("tr");
  for (const title of titles) {
    const cell = document.createElement("th");
    cell.textContent = title;
    row.append(cell);
  }
  head.append(row);
  return head;
}

function fillProfileAndLayerSelects() {
  const profile = Number($("profile").value || 0);
  const layer = Number($("layer").value || 0);
  fillSelect($("profile"), Array.from({ length: PROFILE_COUNT }, (_, index) => ({
    value: index,
    name: index === state.keyboardProfile
      ? t("profile.nameActive", { n: index + 1 })
      : t("profile.name", { n: index + 1 }),
  })), profile);
  fillSelect($("layer"), Array.from({ length: LAYERS_PER_PROFILE }, (_, index) => ({
    value: index, name: index === 0 ? t("layer.base") : t("layer.name", { n: index }),
  })), layer);
}

function pendingChanges() {
  if (!state.device) return { config: false, layers: [] };
  const nextConfig = applyConfig(state.draft.configRaw, state.draft.settings);
  const config = nextConfig.some((byte, index) => byte !== state.device.configRaw[index]);
  const layers = state.draft.layers
    .map((mappings, layer) => ({ layer, mappings }))
    .filter(({ layer, mappings }) => mappings.some((mapping, index) => {
      const original = state.device.layers[layer][index];
      return mapping.type !== original.type
        || mapping.code1 !== original.code1
        || mapping.code2 !== original.code2;
    }));
  const macros = JSON.stringify(state.draft.macros) !== JSON.stringify(state.device.macros);
  const advanced = Object.fromEntries(ADVANCED_BANKS.map(({ id }) => [
    id, JSON.stringify(state.draft.advanced[id]) !== JSON.stringify(state.device.advanced[id]),
  ]));
  const anyAdvanced = Object.values(advanced).some(Boolean);
  const travel = state.draft.travel.some((key, index) => {
    const original = state.device.travel[index];
    return TRAVEL_SLIDERS.some(({ field }) => key[field] !== original[field])
      || key.mode !== original.mode
      || key.priority !== original.priority;
  });
  const colors = state.draft.colors.some((color, index) => color !== state.device.colors[index]);
  return { config, layers, travel, macros, advanced, anyAdvanced, colors, nextConfig };
}

function changeCount({ config, layers, travel, macros, advanced, colors }) {
  return (config ? 1 : 0) + layers.length + (travel ? 1 : 0) + (macros ? 1 : 0) + (colors ? 1 : 0)
    + Object.values(advanced ?? {}).filter(Boolean).length;
}

function updateWriteButton() {
  const count = changeCount(pendingChanges());
  $("write").disabled = count === 0;
  $("write").textContent = count === 0
    ? t("toolbar.write")
    : t("toolbar.writeCount", { n: count });
  refreshSaveStatus(count);
  scheduleAutoWrite();
}

async function acceptDisclaimer() {
  try {
    if (localStorage.getItem(DISCLAIMER_KEY) === "true") return true;
  } catch (_) { /* private mode: ask every session */ }
  if (!await askConfirm(t("disclaimer.write"))) return false;
  try { localStorage.setItem(DISCLAIMER_KEY, "true"); } catch (_) { /* not critical */ }
  return true;
}

async function writeChanges({ confirm = true } = {}) {
  const changes = pendingChanges();
  const { config, layers, travel, macros, anyAdvanced, colors } = changes;
  if (changeCount(changes) === 0) return;
  if (!await acceptDisclaimer()) return;

  const summary = [
    config ? t("confirm.writeSettings") : null,
    layers.length
      ? t("confirm.writeLayers", { layers: layers.map(({ layer }) => layer).join(", ") })
      : null,
    travel ? t("confirm.writeTravel") : null,
    macros ? t("confirm.writeMacros") : null,
    anyAdvanced ? t("confirm.writeAdvanced") : null,
    colors ? t("confirm.writeColors") : null,
  ].filter(Boolean).join(", ");
  if (confirm && !await askConfirm(t("confirm.write", { n: state.profile + 1, what: summary }))) return;

  await withBusy(t("busy.writing", { what: summary }), (progress) =>
    writeBanks(changes, progress));
  log("ok", t("log.written"));
  await reload();
}

async function writeBanks({ config, layers, travel, macros, advanced, colors, nextConfig }, progress = () => {}) {
  if (config) {
    progress(t("busy.writing", { what: t("confirm.writeSettings") }));
    await state.board.writeConfig(state.profile, nextConfig);
  }
  for (const { layer, mappings } of layers) {
    progress(t("busy.writing", { what: t("confirm.writeLayers", { layers: layer }) }));
    await state.board.writeKeymap(state.profile, layer, encodeKeymap(mappings));
  }
  if (travel) {
    progress(`${t("busy.writing", { what: t("confirm.writeTravel") })} ${t("busy.slowTravel")}`);
    await state.board.writeTravel(state.profile, encodeTravel(state.draft.travel));
  }
  if (macros) {
    progress(t("busy.writing", { what: t("confirm.writeMacros") }));
    await state.board.writeMacros(state.profile, encodeMacros(state.draft.macros));
  }
  const banks = state.draft.advanced;
  if (advanced?.dks) {
    progress(t("busy.writing", { what: t("confirm.writeAdvanced") }));
    await state.board.writeDks(state.profile, encodeDksBank(banks.dks));
  }
  if (advanced?.pair) {
    progress(t("busy.writing", { what: t("confirm.writeAdvanced") }));
    await state.board.writePairs(state.profile, encodePairBank(banks.pair));
  }
  if (advanced?.toggle) {
    progress(t("busy.writing", { what: t("confirm.writeAdvanced") }));
    await state.board.writeToggles(state.profile, encodeToggleBank(banks.toggle));
  }
  if (colors) {
    progress(t("busy.writing", { what: t("confirm.writeColors") }));
    await state.board.writeColors(state.profile, encodeColors(state.draft.colors));
  }
}

async function restoreBackup() {
  const history = loadBackups(state.profile);
  if (!history.length) throw new Error(t("error.noBackup"));
  if (!await acceptDisclaimer()) return;

  const dialog = $("restore-dialog");
  fillSelect($("restore-pick"), history.map((snapshot, index) => ({
    value: index, name: new Date(snapshot.savedAt).toLocaleString(),
  })), 0);
  $("restore-warning").textContent = t("restore.warning", { n: state.profile + 1 });
  dialog.returnValue = "cancel";
  const picked = await new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(
      dialog.returnValue === "ok" ? Number($("restore-pick").value) : null), { once: true });
    dialog.showModal();
  });
  if (picked === null) return;

  const backup = history[picked];
  const when = new Date(backup.savedAt).toLocaleString();

  await withBusy(t("busy.restoring"), async () => {
    await state.board.writeConfig(state.profile, backup.configRaw);
    for (let layer = 0; layer < backup.keymapsRaw.length; layer += 1) {
      await state.board.writeKeymap(state.profile, layer, backup.keymapsRaw[layer]);
    }
    if (backup.travelRaw) await state.board.writeTravel(state.profile, backup.travelRaw);
    if (backup.macrosRaw) await state.board.writeMacros(state.profile, backup.macrosRaw);
    if (backup.colorsRaw) await state.board.writeColors(state.profile, backup.colorsRaw);
    if (backup.dksRaw) await state.board.writeDks(state.profile, backup.dksRaw);
    if (backup.pairRaw) await state.board.writePairs(state.profile, backup.pairRaw);
    if (backup.toggleRaw) await state.board.writeToggles(state.profile, backup.toggleRaw);
  });
  log("ok", t("log.restored", { n: state.profile + 1, when }));
  await reload();
}

const COPY_KINDS = Object.freeze([
  { value: "layer", nameKey: "copy.layer", perLayer: true },
  { value: "layers", nameKey: "copy.allLayers", perLayer: false },
  { value: "travel", nameKey: "copy.travel", perLayer: false },
  { value: "lighting", nameKey: "copy.lighting", perLayer: false },
]);

function copySourceOptions(perLayer) {
  if (!perLayer) {
    return Array.from({ length: PROFILE_COUNT }, (_, profile) => ({
      value: `${profile}`, name: t("profile.name", { n: profile + 1 }),
    }));
  }
  const options = [];
  for (let profile = 0; profile < PROFILE_COUNT; profile += 1) {
    for (let layer = 0; layer < LAYERS_PER_PROFILE; layer += 1) {
      options.push({
        value: `${profile}:${layer}`,
        name: `${t("profile.name", { n: profile + 1 })} · `
          + (layer === 0 ? t("layer.base") : t("layer.name", { n: layer })),
      });
    }
  }
  return options;
}

function refreshCopyDialog() {
  const kind = COPY_KINDS.find((entry) => entry.value === $("copy-what").value);
  const sources = copySourceOptions(kind.perLayer);
  fillSelect($("copy-from"), sources, sources[0].value);
  if (kind.perLayer) {
    const targets = Array.from({ length: LAYERS_PER_PROFILE }, (_, layer) => ({
      value: `${layer}`,
      name: layer === 0 ? t("layer.base") : t("layer.name", { n: layer }),
    }));
    fillSelect($("copy-to"), targets, String(state.layer));
  } else {
    fillSelect($("copy-to"), [{
      value: `${state.profile}`, name: t("profile.name", { n: state.profile + 1 }),
    }], String(state.profile));
  }
  $("copy-to").disabled = !kind.perLayer;
}

async function readSourceProfile(profile) {
  if (profile === state.profile) return null;
  return withBusy(t("copy.crossProfile", { n: profile + 1 }), async () => {
    const configRaw = await state.board.readConfig(profile);
    const layers = [];
    for (let layer = 0; layer < LAYERS_PER_PROFILE; layer += 1) {
      layers.push(decodeKeymap(await state.board.readKeymap(profile, layer)));
    }
    const travel = decodeTravel(await state.board.readTravel(profile));
    const colors = decodeColors(await state.board.readColors(profile));
    return { configRaw, settings: decodeConfig(configRaw), layers, travel, colors };
  });
}

async function copySettings() {
  const dialog = $("copy-dialog");
  fillSelect($("copy-what"), COPY_KINDS.map((kind) => ({
    value: kind.value, name: t(kind.nameKey),
  })), COPY_KINDS[0].value);
  refreshCopyDialog();
  $("copy-what").onchange = refreshCopyDialog;

  dialog.returnValue = "cancel";
  const choice = await new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok" ? {
      kind: $("copy-what").value,
      from: $("copy-from").value,
      to: $("copy-to").value,
    } : null), { once: true });
    dialog.showModal();
  });
  if (!choice) return;

  const kind = COPY_KINDS.find((entry) => entry.value === choice.kind);
  const [fromProfile, fromLayer] = choice.from.split(":").map(Number);
  const source = await readSourceProfile(fromProfile) ?? state.draft;

  if (kind.value === "layer") {
    const target = Number(choice.to);
    if (fromProfile === state.profile && fromLayer === target) {
      showError(t("copy.sameTarget"));
      return;
    }
    state.draft.layers[target] = structuredClone(source.layers[fromLayer]);
  } else if (kind.value === "layers") {
    if (fromProfile === state.profile) {
      showError(t("copy.sameTarget"));
      return;
    }
    state.draft.layers = structuredClone(source.layers);
  } else if (kind.value === "travel") {
    if (fromProfile === state.profile) {
      showError(t("copy.sameTarget"));
      return;
    }
    state.draft.travel = structuredClone(source.travel);
  } else {
    if (fromProfile === state.profile) {
      showError(t("copy.sameTarget"));
      return;
    }
    state.draft.configRaw = structuredClone(source.configRaw);
    state.draft.settings = structuredClone(source.settings);
    state.draft.colors = structuredClone(source.colors);
  }

  log("ok", t("log.copied", { what: t(kind.nameKey) }));
  renderAll();
}

const BANK_SIZES = Object.freeze({
  config: 64, keymaps: 384, travel: 1024, macros: 2048,
  colors: 384, dks: 1024, pair: 256, toggle: 128,
});

function exportJson() {
  const device = state.device;
  const payload = {
    format: "he30-profile-1",
    device: {
      name: state.board.model.name,
      vendorId: state.board.device.vendorId,
      productId: state.board.device.productId,
      firmware: device.firmware,
    },
    profile: state.profile,
    banks: {
      config: device.configRaw,
      keymaps: device.keymapsRaw,
      travel: encodeTravel(device.travel),
      macros: encodeMacros(device.macros),
      colors: encodeColors(device.colors),
      dks: encodeDksBank(device.advanced.dks),
      pair: encodePairBank(device.advanced.pair),
      toggle: encodeToggleBank(device.advanced.toggle),
    },
    readable: {
      settings: device.settings,
      layers: device.layers.map((mappings) => mappings.slice(0, KEYS.length)),
      travel: device.travel.slice(0, KEYS.length),
      macros: device.macros,
      keys: KEYS.map(({ index, label, matrix }) => ({ index, label, matrix })),
    },
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `he30-profile${state.profile + 1}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  log("ok", t("log.exported", { n: state.profile + 1 }));
}

async function importJson(file) {
  const fail = (reason) => {
    const message = t("import.bad", { name: file.name, reason });
    log("error", message);
    showError(message);
  };

  let payload;
  try {
    payload = JSON.parse(await file.text());
  } catch (error) {
    fail(error.message);
    return;
  }

  const banks = payload?.banks;
  if (!banks) {
    fail(t("import.noBanks"));
    return;
  }
  for (const [name, size] of Object.entries(BANK_SIZES)) {
    const bank = banks[name];
    const lengths = name === "keymaps"
      ? (Array.isArray(bank) ? bank.map((layer) => layer?.length) : [undefined])
      : [bank?.length];
    if (lengths.some((length) => length !== size)) {
      fail(t("import.badSize", { bank: name, got: lengths.join("/"), want: size }));
      return;
    }
    const values = name === "keymaps" ? bank.flat() : bank;
    if (!values.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
      fail(t("import.badByte", { bank: name }));
      return;
    }
  }

  if (state.autoWrite) {
    $("auto-write").checked = false;
    $("auto-write").dispatchEvent(new Event("change", { bubbles: true }));
  }

  state.draft.configRaw = [...banks.config];
  state.draft.settings = decodeConfig(banks.config);
  state.draft.layers = banks.keymaps.map(decodeKeymap);
  state.draft.travel = decodeTravel(banks.travel);
  state.draft.macros = decodeMacros(banks.macros);
  state.draft.colors = decodeColors(banks.colors);
  state.draft.advanced = {
    dks: decodeDksBank(banks.dks),
    pair: decodePairBank(banks.pair),
    toggle: decodeToggleBank(banks.toggle),
  };

  const message = t("import.done", { name: file.name });
  log("ok", message);
  renderAll();
}

window.addEventListener("unhandledrejection", (event) => {
  const message = event.reason?.message ?? String(event.reason);
  log("error", t("log.unhandled", { message }));
});

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("./sw.js").catch(() => { /* not critical */ });
}

await initLocale();
applyStaticStrings();
try {
  state.autoWrite = localStorage.getItem(AUTO_WRITE_KEY) === "true";
} catch (_) { /* private mode: stay without auto-save */ }
$("auto-write").checked = state.autoWrite;
updateAutoWriteMode();
$("travel-actuation").max = String(MAX_ACTUATION);
const RT_MARGIN = 10;
for (const id of ["travel-rt-both", "travel-rt-press", "travel-rt-release"]) {
  $(id).min = String(RT_MARGIN);
  $(id).max = String(MAX_ACTUATION - RT_MARGIN);
}
bindAll();
if (!navigator.hid) {
  $("connect").disabled = true;
  $("connect").title = t("error.noWebHidShort");
} else {
  HE30Device.reconnect(log)
    .then((board) => { if (board) return connect(board); })
    .catch((error) => {
      const message = t("log.autoConnectFailed", { message: error.message });
      log("error", message);
      showError(message);
    });
}
