//! Report framing and bank codecs for the ZUOYA HE30 vendor protocol, without I/O.
//!
//! See `docs/protocol.md`.

#![forbid(unsafe_code)]

pub mod banks;
pub mod config;
pub mod keymap;
pub mod macros;
pub mod protocol;
pub mod travel;

mod num;

pub use num::{clamp_int, wrap_u8};
