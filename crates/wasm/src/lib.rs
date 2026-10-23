//! WebAssembly bindings of `openhelity-core` for the web configurator.
//!
//! Page values are read with JavaScript's own coercions (`Number`, truthiness, `String`).

use js_sys::{Array, Reflect};
use openhelity_core::banks::{self, LooseDks, LooseDksAction, LoosePair};
use openhelity_core::config::{self, IndicatorSettings, LightSettings, Settings};
use openhelity_core::keymap::{self, LooseMapping};
use openhelity_core::macros::{self, LooseStep};
use openhelity_core::protocol::{self, Bank, ReportKind};
use openhelity_core::travel::{self, LooseKeyTravel};
use serde::Serialize;
use wasm_bindgen::prelude::*;

/// `value[name]`, or `undefined` when `value` is not an object.
fn get(value: &JsValue, name: &str) -> JsValue {
    if value.is_object() {
        Reflect::get(value, &JsValue::from_str(name)).unwrap_or(JsValue::UNDEFINED)
    } else {
        JsValue::UNDEFINED
    }
}

/// `Number(value)`; `None` for `undefined` so callers can apply a default.
fn number(value: &JsValue) -> Option<f64> {
    if value.is_undefined() {
        return None;
    }
    Some(
        value
            .as_f64()
            .unwrap_or_else(|| coerce("Number", value).as_f64().unwrap_or(f64::NAN)),
    )
}

/// Call a global conversion function such as `Number` or `String` on a value.
fn coerce(function: &str, value: &JsValue) -> JsValue {
    Reflect::get(&js_sys::global(), &JsValue::from_str(function))
        .ok()
        .and_then(|function| function.dyn_into::<js_sys::Function>().ok())
        .and_then(|function| function.call1(&JsValue::NULL, value).ok())
        .unwrap_or(JsValue::UNDEFINED)
}

fn number_at(value: &JsValue, name: &str) -> Option<f64> {
    number(&get(value, name))
}

fn truthy_at(value: &JsValue, name: &str) -> bool {
    get(value, name).is_truthy()
}

/// `String(value ?? "")`.
fn string(value: &JsValue) -> String {
    if value.is_null() || value.is_undefined() {
        return String::new();
    }
    value
        .as_string()
        .unwrap_or_else(|| coerce("String", value).as_string().unwrap_or_default())
}

/// Elements of an array-like value; anything else is empty.
fn items(value: &JsValue) -> Vec<JsValue> {
    if Array::is_array(value) {
        Array::from(value).to_vec()
    } else {
        Vec::new()
    }
}

/// A keymap entry, or `None` when the slot holds `undefined` or `null`.
fn mapping(value: &JsValue) -> Option<LooseMapping> {
    if value.is_null() || value.is_undefined() {
        return None;
    }
    Some(LooseMapping {
        kind: number_at(value, "type"),
        code1: number_at(value, "code1"),
        code2: number_at(value, "code2"),
    })
}

fn to_js<T: Serialize>(value: &T) -> Result<JsValue, JsError> {
    Ok(serde_wasm_bindgen::to_value(value)?)
}

fn flatten(reports: Vec<protocol::Report>) -> Vec<u8> {
    reports.concat()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Constants {
    report_size: usize,
    response_prefix: u8,
    profile_count: u8,
    layers_per_profile: u8,
    advanced_slots: usize,
    macro_slots: usize,
    macro_max_steps: usize,
}

/// Protocol constants, so the page does not keep its own copies.
#[wasm_bindgen]
pub fn constants() -> Result<JsValue, JsError> {
    to_js(&Constants {
        report_size: protocol::REPORT_SIZE,
        response_prefix: protocol::RESPONSE_PREFIX,
        profile_count: protocol::PROFILE_COUNT,
        layers_per_profile: protocol::LAYERS_PER_PROFILE,
        advanced_slots: banks::ADVANCED_SLOTS,
        macro_slots: macros::MACRO_SLOTS,
        macro_max_steps: macros::MACRO_MAX_STEPS,
    })
}

/// Read requests for a bank region, as consecutive 64-byte reports.
#[wasm_bindgen(js_name = readRequests)]
pub fn read_requests(command: u8, offset: u16, size: usize) -> Vec<u8> {
    flatten(protocol::read_requests(command, offset, size))
}

/// Write requests for a bank region, as consecutive 64-byte reports.
#[wasm_bindgen(js_name = writeRequests)]
pub fn write_requests(command: u8, offset: u16, data: &[u8]) -> Vec<u8> {
    flatten(protocol::write_requests(command, offset, data))
}

/// The data a read reply carries for a request that asked for `length` bytes.
#[wasm_bindgen(js_name = replyData)]
pub fn reply_data(reply: &[u8], length: usize) -> Vec<u8> {
    protocol::reply_data(reply, length).to_vec()
}

#[wasm_bindgen(js_name = firmwareRequest)]
pub fn firmware_request() -> Vec<u8> {
    protocol::firmware_request().to_vec()
}

#[wasm_bindgen(js_name = parseFirmware)]
pub fn parse_firmware(reply: &[u8]) -> String {
    protocol::parse_firmware(reply)
}

#[wasm_bindgen(js_name = identifiersRequest)]
pub fn identifiers_request() -> Vec<u8> {
    protocol::identifiers_request().to_vec()
}

/// The active profile (0–2) from the identifiers reply.
#[wasm_bindgen(js_name = activeProfile)]
pub fn active_profile(reply: &[u8]) -> u8 {
    protocol::active_profile(reply)
}

/// `{ layer, profile }` of a `0xA1` report.
#[wasm_bindgen(js_name = decodeLayerReport)]
pub fn decode_layer_report(report: &[u8]) -> Result<JsValue, JsError> {
    to_js(&protocol::decode_layer_report(report))
}

/// `"telemetry"`, `"layer"` or `"other"`.
#[wasm_bindgen(js_name = reportKind)]
pub fn report_kind(report: &[u8]) -> String {
    match protocol::classify(report) {
        ReportKind::Telemetry => "telemetry",
        ReportKind::Layer => "layer",
        ReportKind::Other => "other",
    }
    .into()
}

#[wasm_bindgen(js_name = decodeTelemetry)]
pub fn decode_telemetry(report: &[u8]) -> Result<JsValue, JsError> {
    to_js(&protocol::decode_telemetry(report))
}

/// `{ read, write, offset, size }` of a bank: `"config"`, `"keymap"`,
/// `"colors"`, `"macros"`, `"travel"`, `"dks"`, `"pairs"` or `"toggles"`.
#[wasm_bindgen(js_name = bankRegion)]
pub fn bank_region(name: &str, profile: u8, layer: u8) -> Result<JsValue, JsError> {
    let bank =
        Bank::from_name(name).ok_or_else(|| JsError::new(&format!("Unknown bank: {name}")))?;
    to_js(&bank.region(profile, layer))
}

#[wasm_bindgen(js_name = withTelemetry)]
pub fn with_telemetry(config: &[u8], enabled: bool) -> Vec<u8> {
    protocol::with_telemetry(config, enabled)
}

#[wasm_bindgen(js_name = decodeKeymap)]
pub fn decode_keymap(bytes: &[u8]) -> Result<JsValue, JsError> {
    to_js(&keymap::decode(bytes))
}

#[wasm_bindgen(js_name = encodeKeymap)]
pub fn encode_keymap(mappings: JsValue) -> Vec<u8> {
    let entries: Vec<_> = items(&mappings).iter().map(mapping).collect();
    keymap::encode(&entries)
}

#[wasm_bindgen(js_name = decodeTravel)]
pub fn decode_travel(bytes: &[u8]) -> Result<JsValue, JsError> {
    to_js(&travel::decode(bytes))
}

#[wasm_bindgen(js_name = encodeTravel)]
pub fn encode_travel(keys: JsValue) -> Vec<u8> {
    let keys: Vec<_> = items(&keys)
        .iter()
        .map(|key| {
            (!key.is_null() && !key.is_undefined()).then(|| LooseKeyTravel {
                switch_type: number_at(key, "switchType"),
                mode: number_at(key, "mode"),
                priority: number_at(key, "priority"),
                actuation: number_at(key, "actuation"),
                rt_press: number_at(key, "rtPress"),
                rt_release: number_at(key, "rtRelease"),
                press_precision: number_at(key, "pressPrecision"),
                release_precision: number_at(key, "releasePrecision"),
                press_deadzone: number_at(key, "pressDeadzone"),
                release_deadzone: number_at(key, "releaseDeadzone"),
            })
        })
        .collect();
    travel::encode(&keys)
}

#[wasm_bindgen(js_name = decodeConfig)]
pub fn decode_config(bytes: &[u8]) -> Result<JsValue, JsError> {
    to_js(&config::decode(bytes))
}

fn light_settings(value: &JsValue) -> LightSettings {
    LightSettings {
        effect: number_at(value, "effect"),
        brightness: number_at(value, "brightness"),
        speed: number_at(value, "speed"),
        direction: number_at(value, "direction"),
        multicolor: truthy_at(value, "multicolor"),
        color: string(&get(value, "color")),
    }
}

#[wasm_bindgen(js_name = applyConfig)]
pub fn apply_config(bytes: &[u8], settings: JsValue) -> Vec<u8> {
    let settings = Settings {
        report_rate: number_at(&settings, "reportRate"),
        tick_rate: number_at(&settings, "tickRate"),
        lock_win: truthy_at(&settings, "lockWin"),
        lock_alt_tab: truthy_at(&settings, "lockAltTab"),
        lock_alt_f4: truthy_at(&settings, "lockAltF4"),
        stability_mode: truthy_at(&settings, "stabilityMode"),
        check_mode: truthy_at(&settings, "checkMode"),
        debounce: number_at(&settings, "debounce"),
        light: light_settings(&get(&settings, "light")),
        indicator: IndicatorSettings {
            effect: number_at(&get(&settings, "indicator"), "effect"),
            brightness: number_at(&get(&settings, "indicator"), "brightness"),
        },
    };
    config::apply(bytes, &settings)
}

#[wasm_bindgen(js_name = decodeColors)]
pub fn decode_colors(bytes: &[u8]) -> Result<JsValue, JsError> {
    to_js(&banks::decode_colors(bytes))
}

/// Per-key colours back into the bank; each entry goes through `String(v)`.
#[wasm_bindgen(js_name = encodeColors)]
pub fn encode_colors(colors: JsValue) -> Vec<u8> {
    let colors: Vec<String> = items(&colors).iter().map(string).collect();
    banks::encode_colors(&colors)
}

#[wasm_bindgen(js_name = decodePairBank)]
pub fn decode_pair_bank(bytes: &[u8]) -> Result<JsValue, JsError> {
    to_js(&banks::decode_pairs(bytes))
}

#[wasm_bindgen(js_name = encodePairBank)]
pub fn encode_pair_bank(entries: JsValue) -> Vec<u8> {
    let entries: Vec<_> = items(&entries)
        .iter()
        .map(|entry| LoosePair {
            first: mapping(&get(entry, "first")),
            second: mapping(&get(entry, "second")),
        })
        .collect();
    banks::encode_pairs(&entries)
}

#[wasm_bindgen(js_name = decodeToggleBank)]
pub fn decode_toggle_bank(bytes: &[u8]) -> Result<JsValue, JsError> {
    to_js(&banks::decode_toggles(bytes))
}

#[wasm_bindgen(js_name = encodeToggleBank)]
pub fn encode_toggle_bank(entries: JsValue) -> Vec<u8> {
    let entries: Vec<_> = items(&entries).iter().map(mapping).collect();
    banks::encode_toggles(&entries)
}

#[wasm_bindgen(js_name = decodeDksBank)]
pub fn decode_dks_bank(bytes: &[u8]) -> Result<JsValue, JsError> {
    to_js(&banks::decode_dks(bytes))
}

#[wasm_bindgen(js_name = encodeDksBank)]
pub fn encode_dks_bank(entries: JsValue) -> Vec<u8> {
    let entries: Vec<_> = items(&entries)
        .iter()
        .map(|entry| LooseDks {
            points: items(&get(entry, "points")).iter().map(number).collect(),
            actions: items(&get(entry, "actions"))
                .iter()
                .map(|action| LooseDksAction {
                    mapping: mapping(action).unwrap_or_default(),
                    status: number_at(action, "status"),
                })
                .collect(),
        })
        .collect();
    banks::encode_dks(&entries)
}

#[wasm_bindgen(js_name = decodeMacros)]
pub fn decode_macros(bytes: &[u8]) -> Result<JsValue, JsError> {
    to_js(&macros::decode(bytes))
}

#[wasm_bindgen(js_name = encodeMacros)]
pub fn encode_macros(slots: JsValue) -> Result<Vec<u8>, JsError> {
    let slots: Vec<Vec<LooseStep>> = items(&slots)
        .iter()
        .map(|steps| {
            items(steps)
                .iter()
                .map(|step| LooseStep {
                    // `step.kind ?? 2`: null counts as missing here.
                    kind: Some(get(step, "kind"))
                        .filter(|kind| !kind.is_null())
                        .as_ref()
                        .and_then(number),
                    pressed: truthy_at(step, "pressed"),
                    code: number_at(step, "code"),
                    delay: number_at(step, "delay"),
                })
                .collect()
        })
        .collect();
    Ok(macros::encode(&slots)?)
}
