//! Keymap entries: three bytes per key, `[type, code1, code2]`.

use crate::num::wrap_u8;
use crate::protocol::KEY_COUNT;

/// One keymap entry; see `docs/protocol.md`, “The keymap entry format”.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
pub struct Mapping {
    #[cfg_attr(feature = "serde", serde(rename = "type"))]
    pub kind: u8,
    pub code1: u8,
    pub code2: u8,
}

/// A keymap entry from a user interface: fields may be missing and are not yet bytes.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct LooseMapping {
    pub kind: Option<f64>,
    pub code1: Option<f64>,
    pub code2: Option<f64>,
}

impl Mapping {
    /// The entry at `at`; bytes past the end of `bytes` read as `fill`.
    pub fn read(bytes: &[u8], at: usize, fill: u8) -> Mapping {
        let get = |index: usize| bytes.get(at + index).copied().unwrap_or(fill);
        Mapping {
            kind: get(0),
            code1: get(1),
            code2: get(2),
        }
    }

    pub fn to_bytes(self) -> [u8; 3] {
        [self.kind, self.code1, self.code2]
    }
}

impl LooseMapping {
    /// Missing fields become `fill`; the rest keep their low byte.
    pub fn resolve(self, fill: u8) -> Mapping {
        let get = |value: Option<f64>| value.map_or(fill, wrap_u8);
        Mapping {
            kind: get(self.kind),
            code1: get(self.code1),
            code2: get(self.code2),
        }
    }
}

/// Decode one layer's keymap bank. Missing entries read as unassigned (`FF`).
pub fn decode(bytes: &[u8]) -> Vec<Mapping> {
    (0..KEY_COUNT)
        .map(|index| Mapping::read(bytes, index * 3, 0xff))
        .collect()
}

/// Encode a layer: always [`KEY_COUNT`] entries, missing ones unassigned.
pub fn encode(mappings: &[Option<LooseMapping>]) -> Vec<u8> {
    (0..KEY_COUNT)
        .flat_map(|index| {
            let entry = mappings.get(index).copied().flatten().unwrap_or_default();
            entry.resolve(0xff).to_bytes()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let mut bank = vec![0xff; 384];
        bank[..3].copy_from_slice(&[0x10, 0, 0x29]);
        bank[78..81].copy_from_slice(&[0xf0, 0xff, 0x01]);
        let decoded = decode(&bank);
        assert_eq!(
            decoded[0],
            Mapping {
                kind: 0x10,
                code1: 0,
                code2: 0x29
            }
        );
        let loose: Vec<_> = decoded
            .iter()
            .map(|entry| {
                Some(LooseMapping {
                    kind: Some(f64::from(entry.kind)),
                    code1: Some(f64::from(entry.code1)),
                    code2: Some(f64::from(entry.code2)),
                })
            })
            .collect();
        assert_eq!(encode(&loose), bank);
    }

    #[test]
    fn short_input_is_unassigned() {
        assert_eq!(
            decode(&[0x10])[0],
            Mapping {
                kind: 0x10,
                code1: 0xff,
                code2: 0xff
            }
        );
        assert_eq!(encode(&[]), vec![0xff; 384]);
    }
}
