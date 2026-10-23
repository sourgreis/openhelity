const STORAGE_KEY = "he30:locale";
const ENGLISH = Object.freeze({ value: "en", name: "English" });
const localeUrl = (name) => new URL(`../locales/${name}`, import.meta.url);

export const BASE = {
  "app.title": "OpenHElity",
  "app.subtitle": "open configurator",
  "app.notConnected": "not connected",
  "app.connect": "Connect keyboard",
  "app.disconnect": "Disconnect",

  "intro.heading": "ZUOYA HE30 configurator",
  "intro.lead":
    "Press “Connect keyboard” and pick HE 30 (G-COME, 19F5:FD50) in the system dialog.",
  "intro.requirements":
    "Requires Chrome, Edge or another Chromium with WebHID over a secure connection (https:// or localhost). Your keyboard data never leaves this computer.",
  "intro.disclaimer":
    "An independent project, not affiliated with or endorsed by ZUOYA, G-COME or EPOMAKER. Provided as is, without warranty.",
  "disclaimer.write":
    "OpenHElity is an independent project, not affiliated with or endorsed by ZUOYA, G-COME or EPOMAKER; the protocol was worked out on its own. Writing changes what is stored on the keyboard. The software comes without warranty and you use it at your own risk. Continue?",

  "toolbar.profile": "Profile",
  "toolbar.layer": "Layer",
  "toolbar.reload": "Reload",
  "toolbar.export": "Save JSON",
  "toolbar.import": "Load JSON",
  "import.done":
    "Loaded {name}. Auto-save is off — check the result and press “Write to keyboard”.",
  "import.bad": "{name} is not a profile export from this app: {reason}",
  "import.noBanks": "no raw banks in the file",
  "import.badSize": "bank {bank} has {got} bytes instead of {want}",
  "import.badByte": "bank {bank} holds values that are not bytes",
  "toolbar.restore": "Restore backup",
  "toolbar.copy": "Copy…",
  "copy.title": "Copy settings",
  "copy.what": "What",
  "copy.from": "From",
  "copy.to": "Into",
  "copy.layer": "One layer's key mappings",
  "copy.allLayers": "All four layers of the profile",
  "copy.travel": "Key travel",
  "copy.lighting": "Lighting and device settings",
  "copy.note":
    "Copies into the staged draft of the current profile. Nothing reaches the keyboard until you press “Write to keyboard”. Keys with macros or advanced keys keep pointing at the same slot numbers; the slots themselves are not copied.",
  "copy.sameTarget": "Source and destination are the same — nothing to copy.",
  "copy.crossProfile": "Reading profile {n} to copy from…",
  "log.copied": "Copied: {what}",

  "toolbar.autoWrite": "Auto-save",
  "toolbar.autoWriteHint":
    "Write changes to the keyboard automatically, without confirmation. A change counts as finished when you release the slider or pick the colour; the write starts 3 seconds after the last one. The key-travel bank still takes around a minute to program.",
  "status.saved": "All saved",
  "status.pending": "Saving…",

  "toolbar.write": "Write to keyboard",
  "toolbar.writeCount": "Write to keyboard ({n})",

  "board.keyTitle": "{label} → {action}\nbank index {index}, matrix {matrix}",

  "board.selected": "{n} keys selected",
  "board.selectedOne": "1 key selected: {label}",
  "board.selectNone": "No keys selected",
  "board.selectAll": "Select all",
  "board.clearSelection": "Clear",
  "board.hintSelect":
    "Hold and sweep across keys to select them; start on a selected key to deselect instead. Shift+click extends the range, a click on the background clears everything, and a double-click opens the remap dialog.",

  "tab.remap": "Remap",
  "tab.lighting": "RGB Settings",
  "tab.actuation": "Actuation Point",
  "tab.rt": "Rapid Trigger",
  "tab.settings": "Settings",
  "tab.macros": "Macros",
  "tab.shortcuts": "Shortcuts",
  "tab.log": "Log",

  "light.keys": "Key backlight",
  "light.effect": "Effect",
  "light.brightness": "Brightness",
  "light.speed": "Speed",
  "light.color": "Colour",
  "light.multicolor": "multicolour (the effect's own colours)",
  "light.indicator": "Indicator LED",
  "light.indicatorHint": "The small LED on the top plate. Its colour is set by the firmware; Fn + G turns it off until the profile is loaded again.",
  "light.indicatorOff": "Turn indicator off",
  "light.effectN": "Effect {n}",
  "light.turnOff": "Turn backlight off",
  "light.warnOff": "The effect is off, so brightness, speed and colour have no visible result.",
  "light.warnDark": "Brightness is 0, so the effect and colour are not visible.",
  "light.fixEffect": "Switch to “{name}”",
  "light.fixBrightness": "Raise brightness to 80",
  "light.perKeyTitle": "Per-key colours",
  "light.perKeyHint": "Select keys on the diagram and pick their colour.",
  "light.keyColor": "Colour of the selected keys",
  "light.perKeyOff": "Per-key colours only show with the “Custom” effect.",
  "light.perKeyEnable": "Switch to “Custom”",
  "light.hostDriven":
    "Music rhythm only works with the official ZUOYA driver running: it turns sound into frames on the computer and sends them to the keyboard. The configurator cannot do that, so the effect cannot be picked here.",

  "hall.hint":
    "Values are in millimetres. Select keys on the board above; edits apply to the whole selection.",
  "remap.search": "Search for a character",
  "remap.needSelection":
    "Select one or more keys on the board above, then pick what to assign.",
  "remap.assignedTo": "{action} → {keys}",
  "remap.nothingFound": "Nothing matches “{query}”.",
  "remap.groupBasic": "Basic characters",
  "remap.toggleGroup": "Show or hide {name}",
  "remap.groupModifiers": "Modifiers",
  "remap.groupFunction": "Function keys",
  "remap.groupNavigation": "Navigation",
  "remap.groupNumpad": "Numpad",
  "remap.groupMouse": "Mouse",
  "remap.groupMedia": "Media and system",
  "remap.groupFunctions": "Keyboard functions",
  "remap.groupLayers": "Layers and profiles",
  "remap.groupMacros": "Macros",
  "remap.groupAdvanced": "Advanced slots",
  "remap.clearKey": "Unassigned",
  "rt.enable": "Enable Rapid Trigger",
  "rt.enableText": "Rapid Trigger actuates and resets the key as soon as you change direction, instead of at a fixed point. It starts and ends past the actuation point.",
  "rt.count": "Enabled on {n} keys",
  "rt.sensitivity": "Rapid Trigger sensitivity",
  "rt.split": "Split sensitivity",
  "rt.sensitivityLabel": "Sensitivity",
  "rt.pressLabel": "Key press — activate",
  "rt.releaseLabel": "Key release — deactivate",
  "rt.high": "High",
  "rt.low": "Low",
  "rt.continuous": "Continuous Rapid Trigger",
  "rt.continuousText": "When on, Rapid Trigger ends only when the key is fully released. When off, it ends at the actuation point.",
  "rt.continuousInfo": "Turn this on to spam a key without minding the actuation point.",
  "rt.deadzones": "Dead zones",
  "rt.deadzonesNote": "Stored per key by the firmware; their exact effect has not been measured yet.",
  "hall.noKey": "No keys selected.",

  "hall.mixed": "mixed",
  "hall.switchTypeNote":
    "Switch type is read-only: it drives factory calibration and a wrong value breaks travel accuracy.",
  "hall.key": "Key",
  "hall.switchType": "Switch type",
  "hall.actuation": "Actuation point",
  "hall.pressDeadzone": "Press dead zone",
  "hall.releaseDeadzone": "Release dead zone",
  "hall.color": "Key colour",
  "hall.precision": "Editing step",
  "hall.mm": "{n} mm",

  "settings.device": "Device",
  "settings.reportRate": "Polling rate",
  "settings.experimental":
    "Tick rate, debounce and stability mode are stored the way the vendor driver stores them, but what they change on the keyboard has not been measured yet.",
  "settings.tickRate": "Tick rate",
  "settings.debounce": "Debounce",
  "settings.locks": "Locks and modes",
  "settings.lockWin": "lock the Win key",
  "settings.lockAltTab": "lock Alt+Tab",
  "settings.lockAltF4": "lock Alt+F4",
  "settings.stability": "stability mode",
  "settings.firmware": "Firmware",
  "settings.model": "Model",
  "settings.product": "Product",
  "settings.usb": "USB",
  "settings.deviceType": "Device type",
  "settings.rawConfig": "Config (raw)",

  "macros.addKey": "+ Key or combo",
  "macros.addText": "+ Text",
  "macros.addMouse": "+ Mouse click",
  "macros.noStepsHint": "Press “Record” and type on the keyboard, or build it by hand: keys and combinations, text, mouse clicks and pauses.",
  "macros.recordingTitle": "Recording — press keys on the keyboard",
  "macros.recordingStatus": "{n} events · {s} s. Keys are caught by the page, so nothing else reacts. Press Stop when done.",
  "macros.waitingKeys": "Waiting for keys…",
  "macros.waitingKeysHint": "Each press and release shows up here as it happens.",
  "macros.recorded": "Recorded {n} steps into macro {slot}.",
  "macros.keyPrompt": "Press a key or a combination on the keyboard",
  "macros.keyPromptHint": "It is added when all its keys are released.",
  "macros.orPick": "or pick",
  "macros.addThis": "Add",
  "macros.textPlaceholder": "Text to type, e.g. Hello, world!",
  "macros.textHint": "Typed as on a US layout; letters of other alphabets are skipped. Ctrl+Enter adds.",
  "macros.textSkipped": "Skipped characters with no key: {chars}",
  "macros.full": "The profile's macros are full: {max} steps for all 32 slots together.",
  "macros.stuck": "Still held when the macro ends: {keys}.",
  "macros.releaseAtEnd": "Release them at the end",
  "macros.pressArrow": "↓ Press",
  "macros.releaseArrow": "↑ Release",
  "macros.toggleDir": "Switch between press and release",
  "macros.ms": "ms",
  "macros.pause": "Pause after each added key, text character or click",
  "macros.applyAll": "Put it between all steps",
  "macros.realPauses": "Record the real pauses between keys",
  "macros.totals": "{n} steps · plays in {ms} ms · all macros of this profile use {used} of {max} steps",
  "macros.addPause": "+ Pause",
  "macros.pauseBlock": "Pause",
  "macros.addPauseHere": "+ ⏱",
  "macros.addPauseHereTitle": "Add a pause after this step",
  "macros.clickKey": "Click a key on the keyboard above to put {macro} on it; click it again to take it off.",
  "macros.onLayer": "Layer",
  "macros.repeatTimes": "Repeat, times",
  "macros.putOn": "{macro} put on {key} ({layer}). Press “Write to keyboard” to save it.",
  "macros.takenOff": "{macro} taken off {key} ({layer}).",
  "macros.takeOff": "Take the macro off this key",
  "macros.hint": "1. Pick a slot on the left. 2. Record the macro or build it by hand. 3. Click the keys that should play it on the keyboard above. Nothing reaches the keyboard until “Write to keyboard”.",
  "macros.drag": "Drag to move (or ↑ / ↓)",
  "macros.pauseFirst": "A pause cannot start the macro: there is no step before it to wait after.",
  "macros.slots": "Slots",
  "macros.empty": "empty",
  "macros.steps": "{n} steps",
  "macros.clear": "Clear",
  "macros.record": "● Record",
  "macros.stop": "■ Stop",
  "macros.noSteps": "This macro is empty",
  "macros.delete": "Delete step",
  "macros.slotName": "Macro {n}",

  "macros.unassigned": "Not on any key yet.",

  "shortcuts.none": "The base layer has no layer-switch key, so there are no shortcuts.",
  "shortcuts.heading": "{key} → global layer {global} (profile {profile}, layer {layer})",
  "shortcuts.otherProfile":
    "This layer lives in profile {n}. Switch to it to see its contents.",
  "shortcuts.empty": "The layer is empty — no shortcuts assigned.",
  "shortcuts.colCombo": "Shortcut",
  "shortcuts.colAction": "Action",

  "common.cancel": "Cancel",
  "adv.unassigned": "Unassigned",

  "profile.name": "Profile {n}",
  "profile.nameActive": "Profile {n} · on keyboard",
  "log.keyboardProfile": "The keyboard switched to profile {n}.",
  "error.keyboardProfileUnsaved": "The keyboard switched to profile {n}; profile {current} has unsaved changes, so it stays open. Write or reload them to follow.",
  "layer.base": "Base layer",
  "layer.name": "Layer {n}",

  "log.opened": "Opened device {name}",
  "log.reading": "Reading profile {n}…",
  "log.read": "Profile {n} read.",
  "log.disconnected": "Keyboard disconnected.",
  "log.written": "Write finished, re-reading the profile to verify.",
  "log.exported": "Profile {n} exported to JSON.",
  "log.restored": "Profile {n} restored from the backup of {when}.",
  "bank.dks": "profile {n} DKS bank",
  "bank.pairs": "profile {n} Mod-Tap / RS / SOCD bank",
  "bank.toggles": "profile {n} Toggle bank",
  "confirm.writeAdvanced": "advanced keys",

  "tab.advanced": "Advanced keys",
  "adv.addTitle": "Add an advanced key",
  "adv.listTitle": "On this profile",
  "adv.listEmpty": "Nothing yet. Pick a feature on the left, then a key on the keyboard.",
  "adv.fModTap": "Mod-Tap",
  "adv.dModTap": "One action on tap, another while held.",
  "adv.fDks": "DKS",
  "adv.dDks": "Up to four actions at different depths of one press.",
  "adv.fToggle": "Toggle",
  "adv.dToggle": "One press holds the key down, the next releases it.",
  "adv.fKeyPair": "Key pair",
  "adv.fSocd": "SOCD",
  "adv.dSocd": "Of two keys, the one pressed last wins.",
  "adv.keyN": "Key {n}",
  "adv.tap": "Tap",
  "adv.hold": "Hold",
  "adv.toggleAction": "Action to toggle",
  "adv.pairNote": "Each key keeps its own action. Both keys are switched to Rapid Trigger.",
  "adv.remove": "Remove",
  "adv.removeOnly": "Set up by another app. It can be removed here but not edited.",
  "adv.noFreeSlot": "All 32 slots for this feature are in use.",
  "adv.added": "{feature} set on {keys} ({layer}). Press “Write to keyboard” to save it.",
  "adv.removed": "{feature} removed from {keys}.",
  "adv.sumModTap": "tap {tap} · hold {hold} · {ms} ms",
  "adv.sumToggle": "toggles {action}",
  "adv.pointFirst": "First point, mm",
  "adv.pointSecond": "Second point, mm",
  "adv.dksAdd": "Fire the action here",
  "adv.dksPress": "Drag right to hold until a later point; click to remove",
  "adv.dksAction": "Binding {n}: click, then pick its action in the list",
  "adv.dksHint": "Pick a binding, then its action in the list on the left. A “+” fires the binding once when the key passes that point; drag the dot right to keep it held until a later point. Click a dot to remove it.",
  "adv.configuredEmpty": "No keys have {feature} yet.",
  "adv.configuredTitle": "{feature} keys on this profile",
  "adv.continue": "Continue",
  "adv.dksEvent4": "Released back past the first point",
  "adv.dksEvent3": "Released back past the second point",
  "adv.dksEvent2": "Pressed past the second point",
  "adv.dksEvent1": "Pressed past the first point",
  "adv.dksKeyRelease": "Key Release",
  "adv.dksKeyPress": "Key Press",
  "adv.dksBindings": "Bindings",
  "tester.title": "Key tester",
  "tester.active": "Press any key or combination",
  "tester.paused": "Paused while you type in a field",
  "tester.firedAt": "fired at {mm} mm",
  "tester.held": "Held",
  "tester.mouseLeft": "Left mouse button",
  "tester.mouseMiddle": "Middle mouse button",
  "tester.mouseRight": "Right mouse button",
  "tester.mouseBack": "Mouse back",
  "tester.mouseForward": "Mouse forward",
  "tester.mouseOther": "Mouse button {n}",
  "tester.mouseDetail": "mouse",
  "tester.wheelUp": "Wheel up",
  "tester.wheelDown": "Wheel down",
  "adv.pickKeyTo": "Select a key on the keyboard above to assign to {feature}",
  "adv.pickKeysTo": "Select two keys on the keyboard above to assign to {feature}",
  "adv.groupNone": "Nothing",
  "adv.done": "Done",
  "adv.delete": "Delete",
  "adv.keysOn": "On {keys} · {layer}",

  "adv.holdTime": "Hold time",
  "adv.holdMs": "{n} ms",

  "bank.travel": "profile {n} key travel",
  "bank.macros": "profile {n} macros",
  "confirm.writeTravel": "key travel",
  "confirm.writeMacros": "macros",
  "confirm.writeColors": "key colours",
  "bank.colors": "profile {n} key colours",

  "bank.config": "profile {n} config",
  "bank.keymap": "profile {n}, layer {layer} key mappings",

  "log.verified": "Written and verified: {what}",
  "log.noFnKey": "The base layer has no layer switch at the Fn position.",
  "log.backupFailed": "Could not save the backup: {message}",
  "log.backupReadFailed": "Could not read the backup: {message}",
  "log.autoConnectFailed": "Auto-connect failed: {message}",

  "confirm.write": "Write {what} to profile {n}?",
  "confirm.writeSettings": "settings and lighting",
  "confirm.writeLayers": "key mappings for layers {layers}",

  "error.noWebHid":
    "WebHID is unavailable in this browser. Use Chrome, Edge or another Chromium.",
  "error.noWebHidShort": "This browser has no WebHID",
  "error.notSelected": "No device was selected.",
  "error.disconnected": "The keyboard is disconnected.",
  "error.inUse": "The keyboard is already open in another window or tab of the configurator. Close it there first.",
  "error.timeout": "The keyboard did not answer in time.",
  "error.noAck": "The keyboard did not acknowledge command {command}.",
  "error.verify":
    "Write verification for “{what}” failed: byte {index} is {actual}, expected {expected}.",
  "busy.reading": "Reading profile {n}…",
  "busy.writing": "Writing: {what}…",
  "busy.restoring": "Restoring from backup…",
  "busy.slowTravel": "The key-travel bank programs slowly — this takes about a minute.",
  "log.unhandled": "Unhandled error: {message}",
  "error.busy": "The keyboard is busy with another operation.",
  "error.readFailed": "Could not read profile {n}: {message}",

  "restore.title": "Restore from backup",
  "restore.pick": "Snapshot",
  "restore.warning":
    "Writes the chosen snapshot back to profile {n}. All unsaved edits will be lost.",

  "error.noBackup": "There is no backup for this profile.",
  "error.localeFailed": "Could not load the {name} translation; staying in English.",

  "common.ok": "OK",
};

let locale = "en";
let strings = {};
let catalogue = [ENGLISH];
const loaded = new Map();

async function loadCatalogue() {
  try {
    const response = await fetch(localeUrl("index.json"));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const list = await response.json();
    return list
      .filter((entry) => entry && typeof entry.code === "string" && entry.code !== "en")
      .map((entry) => ({ value: entry.code, name: entry.name || entry.code }));
  } catch (_) {
    return [];
  }
}

async function loadStrings(code) {
  if (loaded.has(code)) return loaded.get(code);
  const response = await fetch(localeUrl(`${code}.json`));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const table = await response.json();
  loaded.set(code, table);
  return table;
}

export async function initLocale() {
  catalogue = [ENGLISH, ...await loadCatalogue()];
  let stored = null;
  try { stored = localStorage.getItem(STORAGE_KEY); } catch (_) { /* private mode */ }
  if (stored && stored !== ENGLISH.value) await setLocale(stored);
  document.documentElement.lang = locale;
  return locale;
}

export function locales() {
  return catalogue;
}

export function getLocale() {
  return locale;
}

export async function setLocale(value) {
  if (!catalogue.some((entry) => entry.value === value)) return locale;
  if (value === ENGLISH.value) {
    strings = {};
  } else {
    try {
      strings = await loadStrings(value);
    } catch (_) {
      strings = {};
      value = ENGLISH.value;
    }
  }
  locale = value;
  document.documentElement.lang = locale;
  try { localStorage.setItem(STORAGE_KEY, locale); } catch (_) { /* not critical */ }
  return locale;
}

export function t(key, values = {}) {
  const template = strings[key] ?? BASE[key];
  if (template === undefined) return key;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    (name in values ? String(values[name]) : match));
}

export function label(key, english) {
  return strings[key] ?? english ?? "";
}
