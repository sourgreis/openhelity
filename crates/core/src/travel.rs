//! Key travel (command 160): eight bytes per key, distances in 0.02 mm steps.
//!
//! See `docs/protocol.md`, “Key travel (command 160), 8 bytes per key” and
//! “The unit of the travel values”.

use crate::num::{byte, clamp_int};
use crate::protocol::KEY_COUNT;

/// Settings of one key.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct KeyTravel {
    pub switch_type: u8,
    pub mode: u8,
    pub priority: u8,
    pub actuation: u16,
    pub rt_press: u16,
    pub rt_release: u16,
    pub press_precision: u8,
    pub release_precision: u8,
    pub press_deadzone: u8,
    pub release_deadzone: u8,
}

/// The same settings from a user interface, loosely typed and possibly partial.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct LooseKeyTravel {
    pub switch_type: Option<f64>,
    pub mode: Option<f64>,
    pub priority: Option<f64>,
    pub actuation: Option<f64>,
    pub rt_press: Option<f64>,
    pub rt_release: Option<f64>,
    pub press_precision: Option<f64>,
    pub release_precision: Option<f64>,
    pub press_deadzone: Option<f64>,
    pub release_deadzone: Option<f64>,
}

fn distance(record: &[u8], at: usize) -> u16 {
    (u16::from(byte(record, at)) | (u16::from(byte(record, at + 1) & 1) << 8)) + 1
}

fn decode_key(record: &[u8]) -> KeyTravel {
    let at = |index| byte(record, index);
    KeyTravel {
        switch_type: at(0) & 0x0f,
        mode: at(1) & 0x0f,
        priority: at(1) >> 4,
        actuation: distance(record, 2),
        rt_press: distance(record, 4),
        rt_release: distance(record, 6),
        press_precision: (at(3) >> 3) & 3,
        release_precision: (at(3) >> 1) & 3,
        press_deadzone: at(5) >> 1,
        release_deadzone: at(7) >> 1,
    }
}

/// Decode the bank; records past the end of `bytes` read as zeros.
pub fn decode(bytes: &[u8]) -> Vec<KeyTravel> {
    (0..KEY_COUNT)
        .map(|index| decode_key(bytes.get(index * 8..).unwrap_or(&[])))
        .collect()
}

fn encode_key(key: &LooseKeyTravel) -> [u8; 8] {
    let field = |value: Option<f64>, hi| clamp_int(value.unwrap_or(0.0), 0, hi) as u8;
    let stored = |value: Option<f64>| {
        let [low, high] = ((clamp_int(value.unwrap_or(1.0), 1, 511) - 1) as u16).to_le_bytes();
        (low, high)
    };
    let (actuation, actuation_bit) = stored(key.actuation);
    let (press, press_bit) = stored(key.rt_press);
    let (release, release_bit) = stored(key.rt_release);
    [
        0xa0 | field(key.switch_type, 15),
        field(key.mode, 15) | (field(key.priority, 15) << 4),
        actuation,
        actuation_bit
            | (field(key.press_precision, 3) << 3)
            | (field(key.release_precision, 3) << 1),
        press,
        press_bit | (field(key.press_deadzone, 127) << 1),
        release,
        release_bit | (field(key.release_deadzone, 127) << 1),
    ]
}

/// Encode all [`KEY_COUNT`] keys; missing ones get the defaults.
pub fn encode(keys: &[Option<LooseKeyTravel>]) -> Vec<u8> {
    (0..KEY_COUNT)
        .flat_map(|index| encode_key(&keys.get(index).copied().flatten().unwrap_or_default()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nine_bit_values() {
        let mut bank = vec![0u8; 1024];
        // actuation 300 → stored 299 = 0x12B; press precision 1; press dead zone 5
        bank[..8].copy_from_slice(&[0xa2, 0x21, 0x2b, 0x01 | (1 << 3), 0x00, 5 << 1, 0x09, 0x00]);
        let key = decode(&bank)[0];
        assert_eq!(key.switch_type, 2);
        assert_eq!((key.mode, key.priority), (1, 2));
        assert_eq!(key.actuation, 300);
        assert_eq!(key.press_precision, 1);
        assert_eq!((key.rt_press, key.press_deadzone), (1, 5));
        assert_eq!(key.rt_release, 10);
    }

    #[test]
    fn encode_clamps_and_defaults() {
        let key = LooseKeyTravel {
            actuation: Some(9999.0),
            mode: Some(1.4),
            ..Default::default()
        };
        let bytes = encode(&[Some(key)]);
        assert_eq!(&bytes[..8], &[0xa0, 1, 0xfe, 0x01, 0, 0, 0, 0]);
        assert_eq!(&bytes[8..16], &[0xa0, 0, 0, 0, 0, 0, 0, 0]);
    }
}
