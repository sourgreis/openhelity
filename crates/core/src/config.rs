//! The 64-byte profile config (command 5) and colour helpers.
//!
//! See `docs/protocol.md`, “The profile config, 64 bytes”.

use crate::num::{byte, clamp_int};

/// Size of the config bank of one profile.
pub const CONFIG_SIZE: usize = 64;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct Config {
    pub report_rate: u8,
    pub tick_rate: u8,
    pub lock_win: bool,
    pub lock_alt_tab: bool,
    pub lock_alt_f4: bool,
    pub stability_mode: bool,
    pub check_mode: bool,
    /// Streams `0xA0` telemetry while set.
    pub dynamic_display: bool,
    pub debounce: u8,
    pub light: Light,
    pub indicator: Indicator,
}

/// The main key lighting.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct Light {
    pub effect: u8,
    pub brightness: u8,
    /// Stored as `4 − speed`, so an out-of-range byte reads as negative.
    pub speed: i16,
    pub direction: u8,
    /// The effect uses its own colours and ignores `color`.
    pub multicolor: bool,
    pub color: String,
}

/// The indicator LED on the top plate, which follows Caps Lock.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct Indicator {
    /// `1` colour cycle, `2` static, `3` blinking, `4` dark.
    pub effect: u8,
    /// `0` turns it off.
    pub brightness: u8,
}

/// `#rrggbb` in lower case.
pub fn rgb_to_hex(r: u8, g: u8, b: u8) -> String {
    format!("#{r:02x}{g:02x}{b:02x}")
}

/// Parse `#rrggbb` (the `#` is optional, case does not matter). Anything else
/// is black.
pub fn hex_to_rgb(value: &str) -> [u8; 3] {
    let digits = value.strip_prefix('#').unwrap_or(value);
    if digits.len() != 6 || !digits.bytes().all(|c| c.is_ascii_hexdigit()) {
        return [0; 3];
    }
    let channel = |at: usize| u8::from_str_radix(&digits[at..at + 2], 16).unwrap_or(0);
    [channel(0), channel(2), channel(4)]
}

fn bit(value: u8, index: u8) -> bool {
    (value >> index) & 1 == 1
}

pub fn decode(config: &[u8]) -> Config {
    let at = |index| byte(config, index);
    let color = |from: usize| rgb_to_hex(at(from), at(from + 1), at(from + 2));
    Config {
        report_rate: at(4) & 0x0f,
        tick_rate: at(4) >> 4,
        lock_win: bit(at(6), 0),
        lock_alt_tab: bit(at(6), 1),
        lock_alt_f4: bit(at(6), 2),
        stability_mode: bit(at(7), 1),
        check_mode: bit(at(7), 2),
        dynamic_display: bit(at(7), 3),
        debounce: at(7) >> 5,
        light: Light {
            effect: at(8),
            brightness: at(9),
            speed: 4 - i16::from(at(10)),
            direction: at(11),
            multicolor: at(12) != 0,
            color: color(14),
        },
        indicator: Indicator {
            effect: at(24),
            brightness: at(25),
        },
    }
}

/// Config settings from a user interface. Numbers are loosely typed and may
/// be missing; flags are already reduced to booleans.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Settings {
    pub report_rate: Option<f64>,
    pub tick_rate: Option<f64>,
    pub lock_win: bool,
    pub lock_alt_tab: bool,
    pub lock_alt_f4: bool,
    pub stability_mode: bool,
    pub check_mode: bool,
    pub debounce: Option<f64>,
    pub light: LightSettings,
    pub indicator: IndicatorSettings,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct LightSettings {
    pub effect: Option<f64>,
    pub brightness: Option<f64>,
    pub speed: Option<f64>,
    pub direction: Option<f64>,
    pub multicolor: bool,
    pub color: String,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct IndicatorSettings {
    pub effect: Option<f64>,
    pub brightness: Option<f64>,
}

/// Apply settings onto a copy of the raw bank, padded to [`CONFIG_SIZE`].
///
/// Bytes and bits the settings do not describe are kept as read.
pub fn apply(config: &[u8], settings: &Settings) -> Vec<u8> {
    let mut out = config.to_vec();
    if out.len() < CONFIG_SIZE {
        out.resize(CONFIG_SIZE, 0);
    }
    let int = |value: Option<f64>, hi| clamp_int(value.unwrap_or(f64::NAN), 0, hi) as u8;
    let flag = |on: bool, mask: u8| if on { mask } else { 0 };
    let speed = |value: Option<f64>| clamp_int(4.0 - value.unwrap_or(f64::NAN), 0, 4) as u8;

    out[4] = int(settings.report_rate, 15) | (int(settings.tick_rate, 15) << 4);
    out[6] = (out[6] & 0xf8)
        | flag(settings.lock_win, 1)
        | flag(settings.lock_alt_tab, 2)
        | flag(settings.lock_alt_f4, 4);
    out[7] = (out[7] & 0x19)
        | (int(settings.debounce, 7) << 5)
        | flag(settings.stability_mode, 2)
        | flag(settings.check_mode, 4);

    let light = &settings.light;
    out[8] = int(light.effect, 255);
    out[9] = int(light.brightness, 100);
    out[10] = speed(light.speed);
    out[11] = int(light.direction, 255);
    out[12] = u8::from(light.multicolor);
    out[14..17].copy_from_slice(&hex_to_rgb(&light.color));

    out[24] = int(settings.indicator.effect, 255);
    out[25] = int(settings.indicator.brightness, 100);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn colours() {
        assert_eq!(hex_to_rgb("#FF00aa"), [0xff, 0, 0xaa]);
        assert_eq!(hex_to_rgb("ff00aa"), [0xff, 0, 0xaa]);
        assert_eq!(hex_to_rgb("#fff"), [0; 3]);
        assert_eq!(hex_to_rgb(" #ff00aa"), [0; 3]);
        assert_eq!(rgb_to_hex(1, 2, 255), "#0102ff");
    }

    #[test]
    fn apply_keeps_unknown_bits() {
        let mut raw = vec![0u8; 64];
        raw[7] = 0x18 | 0x07;
        raw[26] = 2;
        raw[29] = 0xff;
        raw[40] = 0x10;
        let mut settings = Settings {
            debounce: Some(3.0),
            ..Default::default()
        };
        settings.light.speed = Some(1.0);
        settings.light.color = "#102030".into();
        let out = apply(&raw, &settings);
        assert_eq!(out[7], 0x19 | (3 << 5));
        assert_eq!(out[10], 3);
        assert_eq!(&out[14..17], &[0x10, 0x20, 0x30]);
        assert_eq!((out[26], out[29]), (2, 0xff));
        assert_eq!(out[40], 0x10);
        let decoded = decode(&out);
        assert_eq!(decoded.debounce, 3);
        assert_eq!(decoded.light.speed, 1);
    }
}
