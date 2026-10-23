# The ZUOYA HE30 protocol

Verified against a live device: `19F5:FD50`, `G-COME` / `HE 30`, firmware
`HALL_HS_USB_KB,Feb 25 2025,19:42:25`.

The implementation is the Rust core in [`crates/core`](../crates/core).

## USB interfaces

The keyboard brings up three HID interfaces:

| # | usage page / usage | Purpose |
| --- | --- | --- |
| 0 | `0x0001` / `0x0006` | the ordinary keyboard (boot protocol) |
| 1 | `0x0001` / `0x0000` | **the vendor configuration channel**, 64-byte reports |
| 2 | `0x0001` / `0x0006`, `0x0002`, `0x0001`, `0x0080`, `0x000c` | NKRO, mouse, consumer, system keys |

The vendor interface descriptor:

```
05 01     Usage Page (Generic Desktop)
09 00     Usage (0x00)
a1 01     Collection (Application)
15 00 26 ff 00   Logical min 0, max 255
19 00 29 08 95 40 75 08 81 02   Input  (64 bytes)
19 01 29 08 95 40 75 08 91 02   Output (64 bytes)
c0
```

No report ID is used (0).

## A transaction

The host sends a 64-byte output report whose first byte is `0x55`. The
device answers with an input report whose first byte is `0xAA`.

```
request:  [0x55, command, 0x00, cks, length, addr_lo, addr_hi, 0, ...]
          cks = (addr_lo + addr_hi + length) & 0xFF
reply:    [0xAA, ...7 header bytes..., data[length]]
```

A single transaction carries at most **56 bytes**; long banks are read in
chunks with an increasing address.

Note that the keyboard sends reports of its own, asynchronously: key-travel
telemetry (`0xA0`, when bit 3 of byte 7 of the config is set) and a
profile-change notification. Those have to be skipped while waiting for a
report prefixed with `0xAA`.

## Memory banks

| Command | What | Size | Offset |
| --- | --- | --- | --- |
| 3 | firmware build string | 32 | 0 |
| 4 | device identifiers | 32 | 0 |
| 5 | profile config | 64 | `64 * profile` |
| 8 | layer keymap | 384 | `2048 * profile + 512 * layer` |
| 10 | stored key colours | 384 | `512 * profile` |
| 12 | macros | 2048 | `2048 * profile` |
| 160 | key-travel settings | 1024 | `1024 * profile` |
| 162 | DKS bank | 1024 | `1024 * profile` |
| 164 | Mod-Tap bank | 256 | `256 * profile` |
| 166 | Toggle bank | 128 | `128 * profile` |

There are 3 profiles and 4 layers per profile, so 12 "global" layers in
total. The keymap bank holds 128 entries — one per firmware matrix position;
29 of them are used on the HE30, left to right and top to bottom: Esc 1–6,
Tab Q–T, Caps A–G, Shift Z–B, Ctrl Fn Alt Space.

The configurator draws the board from that list of factory key codes alone,
placing each code in its ANSI row with its usual ANSI width. The "matrix"
number its key tooltips show, `(row + 1) * 16 + position within the row`,
is computed from those ANSI rows — it is not read from the firmware.

The reply to command 4 on our unit:

```
f5 19 50 fd 00 04 55 55 00 00 ff 00 00 00 00 00 a1 a1 a1 a1 a1 a1 a1 a1
└VID─┘ └PID─┘             └┘
                          active profile, 0–2
```

Data byte 8 is the profile the keyboard is working in: it follows Fn + Q /
W / E at once. Data byte 10 read `ff` in profile 1 and `03` in profiles 2
and 3; its meaning is unknown.

## Writing

Writing a block uses the same scheme plus the data. One more zero byte sits
between the address and the data: the firmware reads the data from index 8
of the report, mirroring where a read reply hands it back.

```
[0x55, command, 0x00, cks, length, addr_lo, addr_hi, 0x00, ...data]
cks = the sum of the bytes from `length` onwards, & 0xFF
```

The alignment is critical: without that zero byte the whole block slides one
byte to the left, the write "succeeds", and the verifying read-back fails —
leaving the bank corrupted. With a 56-byte chunk the data occupies indices
8..63, so the report is filled exactly to the end.

That byte is treated here as padding and always sent as zero, which every
write verifies fine. `svumo/DrunkDeer-Control`, working from a USB capture of
the same OEM firmware under another brand, reads it as an `is_last` flag
marking the final chunk of a transfer (see
[`prior-art.md`](prior-art.md)). A USB capture of the ZUOYA driver on the
HE30 favours padding: it sends zero in the last chunk as well, for the colour
bank (command 11) and the framebuffer (`0xDD`) alike.

The write command is always the read command plus one:

| Bank | Read | Write |
| --- | --- | --- |
| profile config | 5 | 6 |
| layer keymap | 8 | 9 |
| key colours | 10 | 11 |
| macros | 12 | 13 |
| key travel | 160 | 161 |
| DKS | 162 | 163 |
| Mod-Tap | 164 | 165 |
| Toggle | 166 | 167 |

After a write the block must be read back and compared byte for byte. In the
web configurator that is `HE30Device.writeBank`. The ZUOYA driver is
less careful: in a capture it wrote the profile config and the colour bank
and relied on the reply, which echoes the chunk back, without reading
either bank again.

Write speed differs by bank. Measured on a live device: the macro bank
(2048 bytes, 37 chunks) is written and verified in about a second, while the
key-travel bank (1024 bytes, 19 chunks) takes about a minute. The firmware
appears to program that area page by page. The interface has to show
progress, or it looks frozen.

Right after a write the keyboard can leave a read unanswered for a moment,
presumably while it programs its memory. The configurator asks a silent read
again, up to three attempts of 2 seconds each. A read changes nothing, so
repeating it is safe; writes are never repeated.

Two hosts cannot use the vendor interface at once: the reports are not
numbered, so a reply to someone else's request is indistinguishable from
your own. Open the configurator in two tabs, or next to any other tool that
talks to the keyboard, and both sides start receiving each other's replies
and timing out. The configurator therefore holds a Web Lock
(`openhelity-keyboard`) while connected, and a second tab refuses to
connect.

## The keymap entry format

3 bytes per key: `[type, code1, code2]`.

| Type | Meaning |
| --- | --- |
| `0x00`, `0xFF` | unassigned |
| `0x10` | ordinary key: `code1` is the modifier mask, `code2` the HID usage |
| `0x20` | mouse button: `code1` is a bit mask (1 left, 2 right, 4 middle, 8 forward, 16 back) |
| `0x21` | mouse wheel: `code2 = 255` means down, anything else up |
| `0x30` | consumer control, 16-bit usage = `code1 \| (code2 << 8)` |
| `0x40` | system control: 1 power, 2 sleep, 4 wake |
| `0x70` | macro number `code1 + 1`, `code2` is the repeat count |
| `0x90` | DKS, slot `code1` |
| `0x91` | Toggle, slot `code1` |
| `0x92` | Mod-Tap, slot `code1` |
| `0x93` | key pair, slot `code1` |
| `0x94` | SOCD, slot `code1` |
| `0xF0` | internal firmware function, see below |

The modifier mask in `code1` of type `0x10`: bit 0 Ctrl, 1 Shift, 2 Alt,
3 Win, 4 RCtrl, 5 RShift, 6 RAlt, 7 RWin.

### Internal functions (type `0xF0`)

| `code1` | Action |
| --- | --- |
| 4 / 5 / 6 | Windows / macOS / toggle mode |
| 8 | factory reset (hold for 3 s) |
| 27 | indicator LED on/off (not stored in memory) |
| 28 | indicator LED brightness +, step 20, wrapping (config byte 25) |
| 46 / 47 / 48 | lighting effect +/−/pick |
| 50 / 51 | brightness +/− |
| 53 | backlight off |
| 54 / 55 | speed +/− |
| 56 | lighting speed +, wrapping (config byte 10) |
| 60 / 61 / 62 | colour −/+/pick |
| 87 | open the driver website |
| 160 | N-Key Rollover |
| 251 / 252 / 253 | profile 3 / 2 / 1 |
| 255 | switch to layer `code2` (0..11) — this is the Fn key |

Codes `27`, `28` and `56` are absent from other people's work on this
platform — they were identified experimentally, by watching which config byte a
keypress changes. Code `254`, in the factory Fn layer, is recalibration; it
changes no config byte and produces no reports on the vendor interface.

## The advanced-key banks

A key points at a bank slot through its keymap entry: the type sets the
behaviour, `code1` is the slot number, `code2` an extra parameter.

| Type | Behaviour | Bank | `code2` |
| --- | --- | --- | --- |
| `0x90` | DKS | 162, 32 slots of 24 bytes | unused |
| `0x91` | Toggle | 166, 32 slots of 3 bytes | unused |
| `0x92` | Mod-Tap | 164, 32 slots of 6 bytes | hold time in tens of ms |
| `0x93` | key pair | 164, the same bank | the paired key's index |
| `0x94` | SOCD | 164, the same bank | the paired key's index |

**Mod-Tap and the two pair types share one bank.** A slot holds two 3-byte
keymap entries: for Mod-Tap those are the tap and hold actions, for `0x93`
and SOCD they are the pair of keys. Only the type written on the key itself
tells them apart.

For `0x93` and SOCD both keys are additionally put into Rapid Trigger
mode in the travel bank, and for SOCD a priority is written into the
`priority` field, with the mirrored value on the second key: 1 ↔ 2.

The Toggle bank is one keymap entry per slot and nothing else.

Inside all three banks an empty entry is zero, not `FF` as in the keymap
bank.

### DKS (bank 162), 24 bytes per slot

| Offset | Meaning |
| --- | --- |
| 0–3 | four travel points, one byte each (unit: see below) |
| 4–8 | action 1: a keymap entry (3 bytes) plus a 16-bit state word, little-endian |
| 9–13 | action 2 |
| 14–18 | action 3 |
| 19–23 | action 4 |

The four points are the four events of one keystroke, in order: past the
first point going down, past the second going down, back past the second
going up, back past the first going up. The vendor driver writes them as
`[p1, p2, p2, p1]`, e.g. `10 30 30 10` for what it labels 1.0 mm and
3.0 mm, that is tenths of a millimetre. The travel bank's vendor label is
off by a factor of two (see "The unit of the travel values"), so by analogy
the configurator assumes 0.2 mm per step here and would show those points as
2.0 mm and 6.0 mm. That has **not** been measured for DKS.

The state word holds a 3-bit group per event: bits `3k..3k+2` for event `k`
(0–3); bits 12–15 are unused.

| Bit in the group | Meaning |
| --- | --- |
| 0 (`1`) | the action fires at this event |
| 1 (`2`) | it stays held after this event |
| 2 (`4`) | it stays held on through the next event |

So a tap at an event is `1`, and an action pressed at event `s` and released
at event `r` is `7` for events `s..r-2` and `3` for event `r-1`. The last
event can only hold a tap. Examples read back from banks the vendor driver
wrote:

| In the driver | State word |
| --- | --- |
| a dot at event 0, 1, 2, 3 | `0x0001`, `0x0008`, `0x0040`, `0x0200` |
| a bar from event 0 to just before event 3 | `0x00FF` (`7 7 3 0`) |
| a short bar from event 2 to just before event 3 | `0x00C0` (`0 0 3 0`) |

The key itself carries `90 <slot> <its own HID usage>`: the driver keeps the
key's plain usage in `code2`.

## The macro bank (command 12), 2048 bytes per profile

The first 64 bytes are a table of 32 two-byte little-endian offsets, one per
macro slot. An offset of `0` or `64` means an empty slot.

Bytes 64–67 hold a shared empty macro, a single last record
`00 00 80 00`, and an empty slot points at it. The configurator writes the
other macros one after another from offset 68, in slot order.

At the offset sits a chain of 4-byte records:

```
[delay_lo, delay_hi, flags, value]
```

| Field | Meaning |
| --- | --- |
| delay | 16 bits, milliseconds until the next step |
| flags bits 0–5 | record kind: 1 modifier, 2 key, 3 mouse button |
| flags bit 6 | 1 for press, 0 for release |
| flags bit 7 | the macro's last record |
| value | the HID code; for a modifier, a bit mask rather than a code |

The vendor driver records modifier keys as kind 1 with a one-bit mask, bit
*n* for HID usage `E0 + n` (Ctrl, Shift, Alt, Win, then the right-hand
ones). The configurator reads a mask with several bits set as its highest
bit.

A key points at a macro with a type `0x70` entry in the keymap bank:
`code1` is the slot number, `code2` the repeat count.

## The profile config, 64 bytes

| Byte | Bits | Meaning |
| --- | --- | --- |
| 1 | | "system mode" per the vendor; not read or written by the configurator, see below |
| 4 | 0–3 | polling rate: 0 → 8000 Hz, 1 → 4000, 2 → 2000, 3 → 1000 |
| 4 | 4–7 | tick rate: 0 none, 1 → 30, 2 → 60 |
| 6 | 0 / 1 / 2 | lock Win / Alt+Tab / Alt+F4 |
| 7 | 0 | a vendor driver switch whose effect has not been measured; kept as read |
| 7 | 1 | stabilisation mode |
| 7 | 2 | test mode |
| 7 | 3 | Dynamic Display — turns on the `0xA0` telemetry stream; the configurator sets it while showing live depth |
| 7 | 4 | unknown; kept as read |
| 7 | 5–7 | debounce, 0..7 |
| 8 | | main lighting effect, `255` = off, `0` = per-key colours from the colour bank |
| 9 | | brightness 0..100 |
| 10 | | speed, stored as `4 − speed` |
| 11 | | direction |
| 12 | | `1` = multicolour: the effect uses its own colours and ignores 14–16 |
| 13 | | a colour index, meaning unknown; the ZUOYA driver always writes `0` |
| 14–16 | | main lighting RGB |
| 24 | | indicator LED effect: `2` static, `1` colour cycle, `3` blinking in a new colour each time, `4` dark |
| 25 | | indicator LED brightness, `0` = off |
| 26–31 | | unknown; changing 26, 27, 28 or 29–31 does not change the indicator's colour |
| 32–63 | | 32 bytes of `0x10` on our unit, purpose unknown |

Main lighting effects (byte 8): 1 spectrum, 2 stairs, 3 static, 4 breathing,
5 hundred flowers, 6 waves, 7 up-and-down waves, 8 fountain, 9 galaxy,
10 rotation, 11 tide, 12 ocean waves, 13 ripples, 14 always-on ripples,
15 single point, 16 grid, 17 piano, 18 flowing light, 19 raindrops,
20 starlight, 21 fireworks, 22 waveband, 128 music rhythm (fed live by the
host through command `0xDD`).

The ZUOYA driver numbers its 24 presets differently: M0 is music rhythm
(`128`), M1 "Custom Light", the per-key colours (`0`), and from M2 on the
preset is the effect plus one — M2 spectrum, M3 stairs, M4 static,
M5 breathing, M6 hundred flowers, up to M23 waveband. Picking M1 or changing a colour in it
rewrites the whole 384-byte colour bank, once per step of the colour picker.

### Music rhythm is drawn by the driver

Selecting M0 writes nothing but byte 8 = `128`. The driver's "Rhythm" and
"Background" colours are not stored on the keyboard. While sound plays, the
driver renders a spectrum and streams it as full frames through `0xDD`,
about 11 a second (one every ~90 ms); in silence it sends nothing and the
keyboard animates on its own. Captured with the green / yellow / red rhythm
scheme: the columns of the board are frequency bands, a band's level fills
its column from the bottom row up, green at the bottom, then yellow, red at
Esc; every other key gets the background colour. The brightest channel
value in a frame is `fe`, and a white background arrives as `e8e8e8`.

The ZUOYA driver writes the colour as plain RGB in 14–16, its palette
swatches included, and leaves byte 13 at `0`; a `3` seen there before the
driver ever wrote the profile must have been set by the keyboard itself,
probably by the Fn colour keys (functions 60–62). Switching effects, the
driver resets the rest to its defaults: brightness 100, speed and direction
0, multicolour on, RGB `ff0000`. Its speed slider confirms the inverted
storage: moving it down only, from the fastest, wrote `0`, `3`, `4`. It often sends the same config two or three
times in a row.

Byte 1 is the "system mode" according to the vendor: 0 Windows, 1 macOS in
its low bits. That is unverified. It reads `01`, `05` and `09` on profiles
1, 2 and 3 of our unit, so bits 2–3 appear to be the profile's own number;
bit 0 is set on all three although the keyboard runs in Windows mode. The
configurator neither shows nor writes this byte and keeps it as read.

**Byte 12 is not a per-key switch.** With it set, a Static profile set to
white showed solid green on profile 1 and blue on profile 2, whatever the RGB
said; clearing it gave white at once. Per-key colours are effect `0`.

The colour bank (command 10) is indexed like the keymap: entry *n* colours
the key at keymap position *n*, the same order command 7 returns. A capture of the ZUOYA
driver confirms it: painting Esc, Q, A and Space wrote entries 0, 8, 14 and
28, and black (`000000`) everywhere else.

The indicator LED is the small matte one on the top plate, right of "6" on
the HE30. **It is the Caps Lock indicator.** With effect 2 (static) it is red
while Caps Lock is off and blue while it is on; Num Lock, Scroll Lock, the
Win lock (byte 6), the system mode (byte 1) and holding Fn change nothing.
The ZUOYA driver has a "Disable Caps Lock indicator" switch and a "Light
sleep" one (lights off after 15 idle minutes), but hides both for the
HE30, and neither byte 27 nor byte 28 stops the indicator following Caps
Lock — the HE30 firmware may simply lack them. Once it was yellow for a while with Caps Lock off, and nothing
found so far explains it. Its colour comes from the firmware; with effect 2 it stayed red on
profile 1 whatever bytes 27–31 held, even after a replug, and on profile 2
too, with any key colour. Effects 3 and 4 ignore bytes 29–31 as well. Once,
after effect 3 had run on another profile, the static colour came up purple
instead of red. Right after a
config write it can briefly show something else until the profile is loaded
again. Fn + G (function 27) turns it off until then. Switching the
indicator's effect (byte 24) resets it to red; so does loading a profile,
except that switching straight from a profile running the colour cycle can
leave the cycle's colour showing (blue once, on profile 2). The cycle is
fast and its speed was not found in bytes 26–31 either.

The ZUOYA driver cannot colour it either. It lets the indicator be selected,
but picking colours for it only resends the colour bank unchanged —
entries 29–127 stay `000000` — and writes nothing to the profile config.

## Key travel (command 160), 8 bytes per key

| Byte | Bits | Meaning |
| --- | --- | --- |
| 0 | 0–3 | switch type (affects the maximum travel) |
| 0 | 4–7 | meaning unknown; the configurator always writes `0xA` |
| 1 | 0–3 | mode: 0 normal, 1 Rapid Trigger, 2 continuous RT |
| 1 | 4–7 | priority |
| 2 + 3.0 | | actuation point, 9 bits, in 0.02 mm steps (see below), stored as `value − 1` |
| 3 | 1–2 | release precision |
| 3 | 3–4 | press precision |
| 4 + 5.0 | | RT: press travel |
| 5 | 1–7 | press dead zone |
| 6 + 7.0 | | RT: release travel |
| 7 | 1–7 | release dead zone |

Precision step: `0` → 0.01 mm, `1` → 0.005 mm, `2` → 0.001 mm. For device
type `101` (our case) only 0.01 and 0.005 mm are available.

### The unit of the travel values

The travel bank's distances count in **0.02 mm**, the same unit as
telemetry's depth (bytes 6–7), which is what the firmware compares them
with. The vendor driver labels the value as hundredths of a millimetre, so
its "1.00 mm" (100) actually fires at 2.00 mm. Measured on a live HE30 by
tagging each keystroke with the key's depth from telemetry, pressing slowly:

| Value written | Fired at |
| --- | --- |
| 83 | 1.6 mm |
| 100 | 2.0 mm |
| 144 | 2.86 mm |
| 230, 348, 511 | about 2.86 mm |

Anything past about 143 (2.86 mm) behaves the same, so the firmware seems to
cap the actuation point there; the full stroke reads about 185 (3.7 mm).
Rapid Trigger distances are stored in the same unit and are assumed to use
it; that has not been measured. The configurator shows real millimetres.

## Key-travel telemetry (report `0xA0`)

The stream is switched on by bit 3 of byte 7 of the profile config and runs
for as long as the bit is set. It comes only from the profile the keyboard
is working in, with a sample about every 15 ms.

The configurator sets the bit on that profile while it shows live depth and
clears it when it stops, unless the bit was already set. If the page is
closed or the keyboard unplugged in the meantime, the bit stays set and the
stream keeps running until something clears it.

A sample report from a deep press of `Q`:

```
a0 10 00 14 03 1e 00 b9 ff 01 ff 01 02 02 00 b9 04 b7 08 84 00 ...
```

| Byte | Meaning |
| --- | --- |
| 0 | `0xA0` |
| 1–3 | the key's keymap entry: `[type, code1, code2]` — here `10 00 14`, that is `Q` |
| 4–5 | a raw sensor value, most significant byte first; it grows faster than depth towards the bottom |
| 6–7 | press depth, most significant byte first (`00 b9` = 185) |
| 14–15 | the same depth again |
| 8–9, 10–11 | `ff 01` = 511 each, apparently unset 9-bit parameters |
| 16–17 | changes from press to press (`04 b5`, `04 b7`) — probably the sensor reading |
| 18–19 | `08 84` = 2180, constant — probably the sensor's reference value |

A key is identified by its keymap entry rather than by its bank index: to
tell which key is pressed, look for a matching `[type, code1, code2]` in the
base layer.

**The depth unit is 0.02 mm**, the same unit as the travel bank (see "The
unit of the travel values"). Derived from the switch travel: the full
travel is 3.8 mm, and at the bottom the telemetry reads about 190 (185
measured).

A quick press covers more than a millimetre between two samples, so the
configurator takes the depth at a keystroke by interpolating in time between
the sample before it and the one after.

An earlier attempt to calibrate against the moment of actuation, made while
the travel bank was still taken for hundredths of a millimetre, did not work
out: a point set to 1.00 mm (value 100) was observed anywhere in the raw
range 65–168 where 50 was expected then. The spread is explained by latency
— the telemetry lags the finger, and the key event reaches the browser only
after the key has been pressed further down. Slow presses, tagged with the
key's depth, later settled the unit.

### The actuation-threshold experiment: a negative result

The idea was to leave the host out of it: give eight keys different
actuation points and find the one where the key stops registering even when
bottomed out. Had that threshold turned up around 185, it would have proved
that the travel bank and the telemetry count in the same units.

Measured on a live device (profile 1, every key in normal mode):

| Key | Q | W | E | R | T | A | S | D |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Threshold | 120 | 160 | 185 | 210 | 240 | 280 | 320 | 380 |
| Registered | yes | yes | yes | yes | no | yes | yes | yes |

They all registered, including `D` at a threshold of 380 — "3.80 mm", well
past what the telemetry reports at the bottom. **Rather than disabling a key
whose threshold is unreachable, the firmware clamps the value to the real
range.** The method does not work.

Indirect confirmation: `D` at a threshold of 380 registered at raw 87–119 —
the same place as `Q` at a threshold of 100. Both ended up with the same
effective actuation point, so the value really is clamped.

Why `T` fell out of that series was never explained: neighbouring keys with
higher thresholds registered, and it did not.

The configurator shows live depth as a share of a fixed 3.8 mm switch
travel: `travel × 0.02 mm / 3.8 mm`.

## Other commands

| Command | Action |
| --- | --- |
| `0x55` + `[1, …]` / `[2, …]` | the vendor driver sends 1 with a zero payload before every group of reads or writes and 2 after it. Config writes show up at once without them; what they do is unknown |
| read 7, 512 bytes at 0 | the factory keymap, in keymap order (29 keys, then `10 00 00` fillers) |
| `0x55` + `[14, …]` | **not** a profile switch, as older notes had it: the reply's data reads `unknw` and the active profile does not change |
| `0x55` + `[0xA8, 0, 0]` | start switch calibration |
| `0x55` + `[0xA9, 0, 0]` | finish calibration |
| `0x55` + `[0xEE, ...]` | reset a profile (argument 0..2), `0xFF` for all profiles and macros |
| read `0xDE`, 384 bytes | the live RGB framebuffer (needs the Dynamic Display bit) |
| write `0xDD`, 384 bytes | the same framebuffer; the vendor driver uses it for its music effect |
| async report `0xA2` | the vendor driver reads everything again when it arrives |
| async report `0xA0` | key-position telemetry, see above |
| async report `0xA1` | active layer changed: byte 1 is the global layer (0–11, four per profile), byte 2 the active profile, byte 8 the main lighting effect; also byte 10 repeats the profile. Sent on Fn press and release and on a profile switch from the keyboard, e.g. `a1 05 01 …` for profile 2 with Fn held |
