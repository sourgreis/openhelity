# What others have already done

A GitHub search (`gh search repos`) for `he30`, `zuoya`, `gcome`.

## Directly relevant

### `z750sasr/epomaker-he30-alternate-web-driver`

<https://github.com/z750sasr/epomaker-he30-alternate-web-driver> — a WebHID
web configurator for the **EPOMAKER HE30**, with no build step, living on
GitHub Pages:
<https://z750sasr.github.io/epomaker-he30-alternate-web-driver/>

This is the most valuable find: it reverse-engineers the whole protocol of
this keyboard family. The basics it established: requests and replies are
64-byte HID reports, a request starts with `0x55` and a reply with `0xAA`, one
transaction moves up to 56 bytes of payload, and the firmware keeps 3 profiles
of 4 layers over a 128-position key matrix.

The devices it knows about:

| Model | VID:PID | device type | Profiles |
| --- | --- | --- | --- |
| EPOMAKER HE30 | `19F5:FB27` | 102 | 1 |
| EPOMAKER HE30 | `19F5:FB4C` | 104 | 3 |
| EPOMAKER GT60 | `19F5:FB79` | 105 | 1 |

Known commands: the `0x55/0xAA` exchange, `0x0A`/`0x0B` for the profile's
stored RGB bank, `0xA0` for the diagnostic stream of key positions (switched
on by bit 3 of byte 7 of the config), `0xDE` for the 384-byte RGB
framebuffer, `0xEE` to reset a profile (argument `0..2` is the profile
number, `0xFF` means all profiles plus macros). Firmware and the bootloader
are deliberately not supported there.

`HE30_PHYSICAL_HID_CODES` from that repository lists 36 keys, and the first
29 of them match ZUOYA's `layouts/HE 30.xml` byte for byte, while the last 7
(`` ` ``, F1–F6) land exactly in matrix row 0, which the ZUOYA HE30 does not
have. So ZUOYA and EPOMAKER share **one OEM platform**; `device_type="101"`
in ZUOYA's `config.xml` is one more entry in the same 101/102/103/104/105
series.

What remained to check on a live device: whether the VID/PID match and
whether ZUOYA speaks the same `0x55`/`0xAA`.

### `svumo/DrunkDeer-Control` and `deerios/DrunkDeerSDK`

<https://github.com/svumo/DrunkDeer-Control> (MIT) — a .NET driver for
DrunkDeer keyboards, and <https://github.com/deerios/DrunkDeerSDK> (MIT), the
.NET library it cross-validates against.

DrunkDeer matters here because its newer OEM variants ship with vendor ID
`19F5` — ours — and speak the same protocol. Their
[`docs/keyboard-protocol-gen2.md`](https://github.com/svumo/DrunkDeer-Control/blob/main/docs/keyboard-protocol-gen2.md)
names it the "extended gateway" format, and its request layout is the one
described in [`protocol.md`](protocol.md) field for field: prefix,
command, a zero, checksum, length, a little-endian address, one more byte,
then data. It agrees with what was captured here down to per-profile data at
`N × 0x400` and 8-byte per-key travel records. Two independent reversings of
one OEM firmware agreeing is about as much confirmation as this gets. The one
thing they add is a reading for byte 7, which this project had taken for
padding — see [`protocol.md`](protocol.md).

Their [`CONTEXT.md`](https://github.com/svumo/DrunkDeer-Control/blob/main/CONTEXT.md)
is also the clearest write-up of how one OEM firmware ends up behind several
brands.

## Indirectly useful

| Repository | About |
| --- | --- |
| [`ikkentim/gmk87-usb-reverse`](https://github.com/ikkentim/gmk87-usb-reverse) | reversing the USB protocol of the ZUOYA GMK87 — method and tooling |
| [`codedgar/gmk87-node`](https://github.com/codedgar/gmk87-node) | an open configurator for the ZUOYA GMK87 (desktop + CLI + Node API) |
| [`vladipus/zuoya-mmr6`](https://github.com/vladipus/zuoya-mmr6) | a Linux driver for the ZUOYA MMR6 |
| [`scatterthought/zuoya-gmk70`](https://github.com/scatterthought/zuoya-gmk70), [`uk-taniyama/qmk_zuoya_gmk70`](https://github.com/uk-taniyama/qmk_zuoya_gmk70) | firmware and a QMK port for the ZUOYA GMK70 |

There is no project on GitHub dedicated to the **ZUOYA HE30 / G-COME HE30**
itself.

Who else builds on this platform, and which chip it is, is in
[`hardware.md`](hardware.md).
