//! Advanced-key banks (162, 164, 166) and per-key colours (command 10).
//!
//! See `docs/protocol.md`, “The advanced-key banks”.

use crate::config::{hex_to_rgb, rgb_to_hex};
use crate::keymap::{LooseMapping, Mapping};
use crate::num::{byte, clamp_int, le16};
use crate::protocol::KEY_COUNT;

/// Slots in each advanced-key bank.
pub const ADVANCED_SLOTS: usize = 32;

const PAIR_SIZE: usize = 6;
const PAIR_BANK_SIZE: usize = 256;
const TOGGLE_SIZE: usize = 3;
const TOGGLE_BANK_SIZE: usize = 128;
const DKS_SIZE: usize = 24;
const DKS_BANK_SIZE: usize = 1024;
const DKS_ACTIONS: usize = 4;
const DKS_ACTION_SIZE: usize = 5;

/// A slot of bank 164: Mod-Tap's tap and hold actions, or the two keys of a pair (types `0x93`, `0x94`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
pub struct Pair {
    pub first: Mapping,
    pub second: Mapping,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct LoosePair {
    pub first: Option<LooseMapping>,
    pub second: Option<LooseMapping>,
}

/// A slot of bank 162.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
pub struct Dks {
    /// Four travel points.
    pub points: Vec<u8>,
    pub actions: Vec<DksAction>,
}

/// A DKS action: a keymap entry and its state word.
///
/// See `docs/protocol.md`, “DKS (bank 162), 24 bytes per slot”.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct DksAction {
    pub mapping: Mapping,
    pub status: u16,
}

/// Serialised flat, as `{ type, code1, code2, status }`.
#[cfg(feature = "serde")]
impl serde::Serialize for DksAction {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut out = serializer.serialize_struct("DksAction", 4)?;
        out.serialize_field("type", &self.mapping.kind)?;
        out.serialize_field("code1", &self.mapping.code1)?;
        out.serialize_field("code2", &self.mapping.code2)?;
        out.serialize_field("status", &self.status)?;
        out.end()
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct LooseDks {
    pub points: Vec<Option<f64>>,
    pub actions: Vec<LooseDksAction>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct LooseDksAction {
    pub mapping: LooseMapping,
    pub status: Option<f64>,
}

fn place(bank: &mut [u8], at: usize, bytes: &[u8]) {
    bank[at..at + bytes.len()].copy_from_slice(bytes);
}

pub fn decode_pairs(bytes: &[u8]) -> Vec<Pair> {
    (0..ADVANCED_SLOTS)
        .map(|slot| Pair {
            first: Mapping::read(bytes, slot * PAIR_SIZE, 0),
            second: Mapping::read(bytes, slot * PAIR_SIZE + 3, 0),
        })
        .collect()
}

pub fn encode_pairs(entries: &[LoosePair]) -> Vec<u8> {
    let mut bank = vec![0; PAIR_BANK_SIZE];
    for (slot, entry) in entries.iter().take(ADVANCED_SLOTS).enumerate() {
        let at = slot * PAIR_SIZE;
        place(
            &mut bank,
            at,
            &entry.first.unwrap_or_default().resolve(0).to_bytes(),
        );
        place(
            &mut bank,
            at + 3,
            &entry.second.unwrap_or_default().resolve(0).to_bytes(),
        );
    }
    bank
}

pub fn decode_toggles(bytes: &[u8]) -> Vec<Mapping> {
    (0..ADVANCED_SLOTS)
        .map(|slot| Mapping::read(bytes, slot * TOGGLE_SIZE, 0))
        .collect()
}

pub fn encode_toggles(entries: &[Option<LooseMapping>]) -> Vec<u8> {
    let mut bank = vec![0; TOGGLE_BANK_SIZE];
    for (slot, entry) in entries.iter().take(ADVANCED_SLOTS).enumerate() {
        place(
            &mut bank,
            slot * TOGGLE_SIZE,
            &entry.unwrap_or_default().resolve(0).to_bytes(),
        );
    }
    bank
}

pub fn decode_dks(bytes: &[u8]) -> Vec<Dks> {
    (0..ADVANCED_SLOTS)
        .map(|slot| {
            let start = slot * DKS_SIZE;
            let points = bytes
                .get(start..)
                .unwrap_or(&[])
                .iter()
                .take(4)
                .copied()
                .collect();
            let actions = (0..DKS_ACTIONS)
                .map(|action| {
                    let at = start + 4 + action * DKS_ACTION_SIZE;
                    DksAction {
                        mapping: Mapping::read(bytes, at, 0),
                        status: le16(bytes, at + 3),
                    }
                })
                .collect();
            Dks { points, actions }
        })
        .collect()
}

pub fn encode_dks(entries: &[LooseDks]) -> Vec<u8> {
    let mut bank = vec![0; DKS_BANK_SIZE];
    for (slot, entry) in entries.iter().take(ADVANCED_SLOTS).enumerate() {
        let start = slot * DKS_SIZE;
        for (index, point) in entry.points.iter().take(4).enumerate() {
            bank[start + index] = clamp_int(point.unwrap_or(0.0), 0, 255) as u8;
        }
        for (index, action) in entry.actions.iter().take(DKS_ACTIONS).enumerate() {
            let at = start + 4 + index * DKS_ACTION_SIZE;
            place(&mut bank, at, &action.mapping.resolve(0).to_bytes());
            let status = clamp_int(action.status.unwrap_or(0.0), 0, 0xffff) as u16;
            place(&mut bank, at + 3, &status.to_le_bytes());
        }
    }
    bank
}

/// Decode the per-key colour bank as `#rrggbb` strings.
pub fn decode_colors(bytes: &[u8]) -> Vec<String> {
    (0..KEY_COUNT)
        .map(|index| {
            rgb_to_hex(
                byte(bytes, index * 3),
                byte(bytes, index * 3 + 1),
                byte(bytes, index * 3 + 2),
            )
        })
        .collect()
}

/// Size of the per-key colour bank.
pub const COLOR_BANK_SIZE: usize = KEY_COUNT * 3;

/// Encode per-key colours (`#rrggbb`); missing or malformed ones are black.
pub fn encode_colors(colors: &[String]) -> Vec<u8> {
    let mut bank = vec![0; COLOR_BANK_SIZE];
    for (index, color) in colors.iter().take(KEY_COUNT).enumerate() {
        place(&mut bank, index * 3, &hex_to_rgb(color));
    }
    bank
}

#[cfg(test)]
mod tests {
    use super::*;

    fn loose(mapping: Mapping) -> LooseMapping {
        LooseMapping {
            kind: Some(mapping.kind.into()),
            code1: Some(mapping.code1.into()),
            code2: Some(mapping.code2.into()),
        }
    }

    #[test]
    fn pairs_round_trip() {
        let bank: Vec<u8> = (0..=255).collect();
        let pairs = decode_pairs(&bank);
        assert_eq!(
            pairs[1].second,
            Mapping {
                kind: 9,
                code1: 10,
                code2: 11
            }
        );
        let entries: Vec<_> = pairs
            .iter()
            .map(|pair| LoosePair {
                first: Some(loose(pair.first)),
                second: Some(loose(pair.second)),
            })
            .collect();
        let mut expected = bank.clone();
        expected[192..].fill(0);
        assert_eq!(encode_pairs(&entries), expected);
    }

    #[test]
    fn dks_round_trip() {
        let bank: Vec<u8> = (0..1024).map(|index| (index * 7 % 251) as u8).collect();
        let slots = decode_dks(&bank);
        let entries: Vec<_> = slots
            .iter()
            .map(|slot| LooseDks {
                points: slot
                    .points
                    .iter()
                    .map(|point| Some(f64::from(*point)))
                    .collect(),
                actions: slot
                    .actions
                    .iter()
                    .map(|action| LooseDksAction {
                        mapping: loose(action.mapping),
                        status: Some(action.status.into()),
                    })
                    .collect(),
            })
            .collect();
        let mut expected = bank.clone();
        expected[ADVANCED_SLOTS * DKS_SIZE..].fill(0);
        assert_eq!(encode_dks(&entries), expected);
    }

    #[test]
    fn colours() {
        let colors = decode_colors(&[0xff, 0x80, 0x00]);
        assert_eq!(colors[0], "#ff8000");
        assert_eq!(colors[1], "#000000");
    }

    #[test]
    fn colours_round_trip() {
        let bank: Vec<u8> = (0..COLOR_BANK_SIZE)
            .map(|index| (index * 5 % 256) as u8)
            .collect();
        assert_eq!(encode_colors(&decode_colors(&bank)), bank);
        let short = encode_colors(&["#ff0000".into(), "bad".into()]);
        assert_eq!(&short[..6], &[0xff, 0, 0, 0, 0, 0]);
        assert_eq!(short.len(), COLOR_BANK_SIZE);
    }
}
