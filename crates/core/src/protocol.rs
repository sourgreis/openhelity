//! Report framing on the vendor HID interface.
//!
//! See `docs/protocol.md`, “A transaction” and “Writing”.

pub const REPORT_SIZE: usize = 64;
/// Largest payload one transaction carries.
pub const CHUNK_SIZE: usize = 56;
pub const REQUEST_PREFIX: u8 = 0x55;
pub const RESPONSE_PREFIX: u8 = 0xaa;
pub const TELEMETRY_PREFIX: u8 = 0xa0;
pub const LAYER_PREFIX: u8 = 0xa1;
/// Where data starts in a reply, and in a write request.
pub const DATA_OFFSET: usize = 8;

pub const PROFILE_COUNT: u8 = 3;
pub const LAYERS_PER_PROFILE: u8 = 4;
/// Entries in a keymap bank; the HE30 uses the first 29.
pub const KEY_COUNT: usize = 128;

/// Config byte 7, bit 3 ("Dynamic Display"): streams `0xA0` telemetry.
pub const TELEMETRY_BIT: u8 = 0x08;

pub type Report = [u8; REPORT_SIZE];

/// A request report: the prefix followed by `args`, zero-padded.
pub fn request(args: &[u8]) -> Report {
    let mut report = [0; REPORT_SIZE];
    report[0] = REQUEST_PREFIX;
    for (slot, value) in report[1..].iter_mut().zip(args) {
        *slot = *value;
    }
    report
}

fn checksum(bytes: &[u8]) -> u8 {
    bytes.iter().fold(0u8, |sum, byte| sum.wrapping_add(*byte))
}

/// Requests that read `size` bytes of a bank starting at `offset`.
pub fn read_requests(command: u8, offset: u16, size: usize) -> Vec<Report> {
    let end = usize::from(offset) + size;
    (usize::from(offset)..end)
        .step_by(CHUNK_SIZE)
        .map(|address| {
            let length = CHUNK_SIZE.min(end - address) as u8;
            let [low, high] = (address as u16).to_le_bytes();
            request(&[
                command,
                0,
                checksum(&[low, high, length]),
                length,
                low,
                high,
            ])
        })
        .collect()
}

/// Requests that write `data` into a bank starting at `offset`.
pub fn write_requests(command: u8, offset: u16, data: &[u8]) -> Vec<Report> {
    data.chunks(CHUNK_SIZE)
        .enumerate()
        .map(|(index, chunk)| {
            let [low, high] = (offset + (index * CHUNK_SIZE) as u16).to_le_bytes();
            let mut body = vec![chunk.len() as u8, low, high, 0];
            body.extend_from_slice(chunk);
            let mut args = vec![command, 0, checksum(&body)];
            args.extend(body);
            request(&args)
        })
        .collect()
}

/// The data a read reply carries for a request asking for `length` bytes.
pub fn reply_data(reply: &[u8], length: usize) -> &[u8] {
    let start = DATA_OFFSET.min(reply.len());
    &reply[start..(DATA_OFFSET + length).min(reply.len())]
}

/// Request for the firmware build string.
pub fn firmware_request() -> Report {
    request(&[3, 0, 32, 32])
}

/// The firmware build string from its reply: data up to the first zero.
pub fn parse_firmware(reply: &[u8]) -> String {
    let data = &reply[DATA_OFFSET.min(reply.len())..];
    let end = data
        .iter()
        .position(|byte| *byte == 0)
        .unwrap_or(data.len());
    data[..end].iter().map(|byte| char::from(*byte)).collect()
}

/// Request for the device identifiers (command 4).
pub fn identifiers_request() -> Report {
    request(&[4, 0, 32, 32])
}

/// The active profile (0–2) from the identifiers reply.
pub fn active_profile(reply: &[u8]) -> u8 {
    crate::num::byte(reply, DATA_OFFSET + 8)
}

/// A `0xA1` report, sent whenever the active layer or profile changes.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
pub struct LayerReport {
    /// The global layer, 0–11: four per profile.
    pub layer: u8,
    /// The active profile, 0–2.
    pub profile: u8,
}

pub fn decode_layer_report(report: &[u8]) -> LayerReport {
    LayerReport {
        layer: crate::num::byte(report, 1),
        profile: crate::num::byte(report, 2),
    }
}

/// What an incoming report is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReportKind {
    /// Key-travel telemetry, sent on its own while the telemetry bit is set.
    Telemetry,
    /// The active layer changed; nobody waits for it.
    Layer,
    /// Anything else: a reply, or a report a waiting request has to inspect.
    Other,
}

pub fn classify(report: &[u8]) -> ReportKind {
    match report.first() {
        Some(&TELEMETRY_PREFIX) => ReportKind::Telemetry,
        Some(&LAYER_PREFIX) => ReportKind::Layer,
        _ => ReportKind::Other,
    }
}

/// A `0xA0` telemetry report.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
pub struct Telemetry {
    /// The pressed key's keymap entry, which is how the key is identified.
    #[cfg_attr(feature = "serde", serde(rename = "type"))]
    pub kind: u8,
    pub code1: u8,
    pub code2: u8,
    /// Press depth in 0.02 mm steps.
    pub travel: u16,
    pub status: u8,
    /// A raw sensor value, not linear in depth.
    pub raw: u16,
}

pub fn decode_telemetry(report: &[u8]) -> Telemetry {
    let at = |index| crate::num::byte(report, index);
    Telemetry {
        kind: at(1),
        code1: at(2),
        code2: at(3),
        travel: u16::from_be_bytes([at(6), at(7)]),
        status: at(10),
        raw: u16::from_be_bytes([at(4), at(5)]),
    }
}

/// A memory bank of one profile.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Bank {
    Config,
    Keymap,
    Colors,
    Macros,
    Travel,
    Dks,
    Pairs,
    Toggles,
}

/// Where a bank lives: the commands that read and write it, and the region.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
pub struct Region {
    pub read: u8,
    pub write: u8,
    pub offset: u16,
    pub size: usize,
}

impl Bank {
    /// The region of this bank for a profile (and, for the keymap, a layer).
    pub fn region(self, profile: u8, layer: u8) -> Region {
        let profile = u16::from(profile);
        let (read, size, offset) = match self {
            Bank::Config => (5, 64, 64 * profile),
            Bank::Keymap => (8, 384, 2048 * profile + 512 * u16::from(layer)),
            Bank::Colors => (10, 384, 512 * profile),
            Bank::Macros => (12, 2048, 2048 * profile),
            Bank::Travel => (160, 1024, 1024 * profile),
            Bank::Dks => (162, 1024, 1024 * profile),
            Bank::Pairs => (164, 256, 256 * profile),
            Bank::Toggles => (166, 128, 128 * profile),
        };
        Region {
            read,
            write: read + 1,
            offset,
            size,
        }
    }

    pub fn from_name(name: &str) -> Option<Bank> {
        Some(match name {
            "config" => Bank::Config,
            "keymap" => Bank::Keymap,
            "colors" => Bank::Colors,
            "macros" => Bank::Macros,
            "travel" => Bank::Travel,
            "dks" => Bank::Dks,
            "pairs" => Bank::Pairs,
            "toggles" => Bank::Toggles,
            _ => return None,
        })
    }
}

/// A copy of a profile config with the telemetry bit set or cleared.
pub fn with_telemetry(config: &[u8], enabled: bool) -> Vec<u8> {
    let mut config = config.to_vec();
    if let Some(flags) = config.get_mut(7) {
        if enabled {
            *flags |= TELEMETRY_BIT;
        } else {
            *flags &= !TELEMETRY_BIT;
        }
    }
    config
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_request_layout() {
        let requests = read_requests(5, 64, 64);
        assert_eq!(requests.len(), 2);
        assert_eq!(&requests[0][..7], &[0x55, 5, 0, (64 + 56) as u8, 56, 64, 0]);
        assert_eq!(&requests[1][..7], &[0x55, 5, 0, (120 + 8) as u8, 8, 120, 0]);
        assert!(requests[1][7..].iter().all(|byte| *byte == 0));
    }

    #[test]
    fn write_request_layout() {
        let data: Vec<u8> = (0..60).collect();
        let requests = write_requests(9, 0x0800, &data);
        assert_eq!(requests.len(), 2);
        let first = &requests[0];
        assert_eq!(
            &first[..8],
            &[0x55, 9, 0, checksum(&first[4..]), 56, 0x00, 0x08, 0]
        );
        assert_eq!(&first[8..], &data[..56]);
        let second = &requests[1];
        assert_eq!(&second[4..8], &[4, 56, 0x08, 0]);
        assert_eq!(&second[8..12], &data[56..]);
    }

    #[test]
    fn telemetry_sample_from_the_docs() {
        let report = [
            0xa0, 0x10, 0x00, 0x14, 0x03, 0x1e, 0x00, 0xb9, 0xff, 0x01, 0xff,
        ];
        let decoded = decode_telemetry(&report);
        assert_eq!(
            (decoded.kind, decoded.code1, decoded.code2),
            (0x10, 0, 0x14)
        );
        assert_eq!(decoded.travel, 185);
        assert_eq!(decoded.status, 0xff);
    }

    #[test]
    fn regions() {
        assert_eq!(
            Bank::Keymap.region(1, 2),
            Region {
                read: 8,
                write: 9,
                offset: 2048 + 1024,
                size: 384
            }
        );
        assert_eq!(
            Bank::Toggles.region(2, 0),
            Region {
                read: 166,
                write: 167,
                offset: 256,
                size: 128
            }
        );
    }

    #[test]
    fn active_profile_from_identifiers() {
        // Read back from a live HE30 in profile 3.
        let mut reply = vec![0xaa, 4, 0, 0x39, 0x20, 0, 0, 0];
        reply.extend([
            0xf5, 0x19, 0x50, 0xfd, 0x00, 0x04, 0x55, 0x55, 0x02, 0x00, 0x03, 0x00,
        ]);
        assert_eq!(active_profile(&reply), 2);
        assert_eq!(&identifiers_request()[..5], &[0x55, 4, 0, 32, 32]);
    }

    #[test]
    fn layer_report() {
        // Profile 2 with Fn held: global layer 5.
        let report = [0xa1, 0x05, 0x01, 0, 0, 0, 0, 0, 0x03, 0, 0x01, 0];
        assert_eq!(
            decode_layer_report(&report),
            LayerReport {
                layer: 5,
                profile: 1
            }
        );
    }

    #[test]
    fn firmware_string() {
        let mut reply = [0u8; 64];
        reply[0] = 0xaa;
        reply[8..12].copy_from_slice(b"HALL");
        assert_eq!(parse_firmware(&reply), "HALL");
    }
}
