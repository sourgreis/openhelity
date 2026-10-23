//! The macro bank (command 12).
//!
//! See `docs/protocol.md`, “The macro bank (command 12), 2048 bytes per profile”.

use crate::num::{byte, clamp_int, le16};

pub const MACRO_SLOTS: usize = 32;
pub const MACRO_BANK_SIZE: usize = 2048;
const HEADER_SIZE: usize = 64;
/// Past the offset table and the shared empty macro.
const RECORDS_START: usize = HEADER_SIZE + RECORD_SIZE;
const RECORD_SIZE: usize = 4;
pub const MACRO_MAX_STEPS: usize = (MACRO_BANK_SIZE - RECORDS_START) / RECORD_SIZE;

const PRESSED: u8 = 0x40;
const LAST: u8 = 0x80;
const KIND_MASK: u8 = 0x3f;

/// Record kinds.
pub const KIND_MODIFIER: u8 = 1;
pub const KIND_KEY: u8 = 2;
pub const KIND_MOUSE: u8 = 3;

/// HID usage of Left Control, the first of the eight modifier usages.
const FIRST_MODIFIER: u32 = 0xe0;

/// One step of a macro; for a modifier `code` is its HID usage, not the bank's bit mask.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
pub struct Step {
    pub kind: u8,
    pub pressed: bool,
    pub code: u8,
    /// Milliseconds until the next step.
    pub delay: u16,
}

/// A step from a user interface.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct LooseStep {
    pub kind: Option<f64>,
    pub pressed: bool,
    pub code: Option<f64>,
    pub delay: Option<f64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Overflow;

impl std::fmt::Display for Overflow {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("Macro bank overflow")
    }
}

impl std::error::Error for Overflow {}

fn decode_step(bytes: &[u8], at: usize) -> (Step, bool) {
    let flags = byte(bytes, at + 2);
    let value = byte(bytes, at + 3);
    let kind = match flags & KIND_MASK {
        0 => KIND_KEY,
        kind => kind,
    };
    let code = if kind == KIND_MODIFIER {
        // The highest set bit names the modifier; an empty mask reads as 0xE0.
        (FIRST_MODIFIER + value.checked_ilog2().unwrap_or(0)) as u8
    } else {
        value
    };
    let step = Step {
        kind,
        pressed: flags & PRESSED != 0,
        code,
        delay: le16(bytes, at),
    };
    (step, flags & LAST != 0)
}

pub fn decode(bytes: &[u8]) -> Vec<Vec<Step>> {
    (0..MACRO_SLOTS)
        .map(|slot| {
            let mut at = usize::from(le16(bytes, slot * 2));
            let mut steps = Vec::new();
            if at == 0 || at == HEADER_SIZE {
                return steps;
            }
            while steps.len() < MACRO_MAX_STEPS && at + 3 < bytes.len() {
                let (step, last) = decode_step(bytes, at);
                steps.push(step);
                at += RECORD_SIZE;
                if last {
                    break;
                }
            }
            steps
        })
        .collect()
}

fn encode_step(step: &LooseStep, last: bool) -> [u8; 4] {
    let kind = step.kind.map_or(KIND_KEY, crate::num::wrap_u8);
    let code = step.code.unwrap_or(0.0);
    let value = if kind == KIND_MODIFIER {
        1 << (clamp_int(code, FIRST_MODIFIER, FIRST_MODIFIER + 7) - FIRST_MODIFIER)
    } else {
        clamp_int(code, 0, 255) as u8
    };
    let flags = kind | if step.pressed { PRESSED } else { 0 } | if last { LAST } else { 0 };
    let [low, high] = (clamp_int(step.delay.unwrap_or(0.0), 0, 0xffff) as u16).to_le_bytes();
    [low, high, flags, value]
}

/// Encode all slots, or fail when the steps do not fit into the bank.
pub fn encode(macros: &[Vec<LooseStep>]) -> Result<Vec<u8>, Overflow> {
    let mut bank = vec![0; MACRO_BANK_SIZE];
    bank[HEADER_SIZE + 2] = LAST;
    let mut at = RECORDS_START;
    for slot in 0..MACRO_SLOTS {
        let steps = macros.get(slot).map_or(&[][..], Vec::as_slice);
        let start = if steps.is_empty() { HEADER_SIZE } else { at };
        bank[slot * 2..slot * 2 + 2].copy_from_slice(&(start as u16).to_le_bytes());
        for (index, step) in steps.iter().enumerate() {
            if at + RECORD_SIZE > MACRO_BANK_SIZE {
                return Err(Overflow);
            }
            bank[at..at + RECORD_SIZE]
                .copy_from_slice(&encode_step(step, index + 1 == steps.len()));
            at += RECORD_SIZE;
        }
    }
    Ok(bank)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn loose(step: Step) -> LooseStep {
        LooseStep {
            kind: Some(step.kind.into()),
            pressed: step.pressed,
            code: Some(step.code.into()),
            delay: Some(step.delay.into()),
        }
    }

    #[test]
    fn round_trip() {
        let macros = [
            vec![],
            vec![
                Step {
                    kind: KIND_MODIFIER,
                    pressed: true,
                    code: 0xe1,
                    delay: 10,
                },
                Step {
                    kind: KIND_KEY,
                    pressed: true,
                    code: 4,
                    delay: 300,
                },
                Step {
                    kind: KIND_KEY,
                    pressed: false,
                    code: 4,
                    delay: 0,
                },
                Step {
                    kind: KIND_MODIFIER,
                    pressed: false,
                    code: 0xe1,
                    delay: 0,
                },
            ],
            vec![Step {
                kind: KIND_MOUSE,
                pressed: true,
                code: 1,
                delay: 5,
            }],
        ];
        let bank = encode(
            &macros
                .iter()
                .map(|steps| steps.iter().copied().map(loose).collect())
                .collect::<Vec<_>>(),
        )
        .unwrap();
        assert_eq!(le16(&bank, 0), 64);
        assert_eq!(le16(&bank, 2), 68);
        assert_eq!(le16(&bank, 4), 68 + 16);
        assert_eq!(&bank[64..68], &[0, 0, 0x80, 0]);
        assert_eq!(&bank[68..72], &[10, 0, 0x41, 0b10]);
        let decoded = decode(&bank);
        assert_eq!(decoded[1], macros[1]);
        assert_eq!(decoded[2], macros[2]);
        assert!(decoded[3].is_empty());
    }

    #[test]
    fn overflow() {
        let long = vec![LooseStep::default(); MACRO_MAX_STEPS + 1];
        assert_eq!(encode(&[long]), Err(Overflow));
        let fits = vec![LooseStep::default(); MACRO_MAX_STEPS];
        assert!(encode(&[fits]).is_ok());
    }
}
