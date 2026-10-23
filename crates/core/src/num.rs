/// Round half up and clamp into `[lo, hi]`; NaN counts as zero.
pub fn clamp_int(value: f64, lo: u32, hi: u32) -> u32 {
    let value = if value.is_nan() {
        0.0
    } else {
        (value + 0.5).floor()
    };
    value.clamp(f64::from(lo), f64::from(hi)) as u32
}

/// The low byte of a number the way JavaScript's `value & 0xff` takes it:
/// truncated toward zero, NaN and infinities as zero, negatives wrapping.
pub fn wrap_u8(value: f64) -> u8 {
    if !value.is_finite() {
        return 0;
    }
    (value.trunc() % 4_294_967_296.0) as i64 as u8
}

/// Little-endian 16-bit value at `at`, missing bytes read as zero.
pub(crate) fn le16(bytes: &[u8], at: usize) -> u16 {
    u16::from(byte(bytes, at)) | (u16::from(byte(bytes, at + 1)) << 8)
}

/// Byte at `at`, or zero past the end of the slice.
pub(crate) fn byte(bytes: &[u8], at: usize) -> u8 {
    bytes.get(at).copied().unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::clamp_int;

    #[test]
    fn rounds_and_clamps() {
        assert_eq!(clamp_int(2.5, 0, 10), 3);
        assert_eq!(clamp_int(2.49, 0, 10), 2);
        assert_eq!(clamp_int(-0.5, 0, 10), 0);
        assert_eq!(clamp_int(f64::NAN, 1, 10), 1);
        assert_eq!(clamp_int(f64::INFINITY, 0, 511), 511);
        assert_eq!(clamp_int(700.0, 0, 511), 511);
    }

    #[test]
    fn wraps_like_javascript() {
        use super::wrap_u8;
        assert_eq!(wrap_u8(256.0), 0);
        assert_eq!(wrap_u8(-1.0), 255);
        assert_eq!(wrap_u8(2.9), 2);
        assert_eq!(wrap_u8(f64::NAN), 0);
    }
}
