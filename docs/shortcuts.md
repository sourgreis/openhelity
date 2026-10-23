# ZUOYA HE30 shortcuts

This table was read off a live keyboard, so it reflects **the current
configuration of one particular unit** rather than the factory layout. The
configurator's Shortcuts section shows the table of your own keyboard.

## How to turn the backlight off

**`Fn` + `D`** — the "backlight off" function (internal code `53`).

Also:

| Combination | Action |
| --- | --- |
| `Fn` + `X` | brightness + |
| `Fn` + `Z` | brightness − |
| `Fn` + `C` | previous lighting effect |
| `Fn` + `A` | previous colour |

The backlight can also be killed programmatically: byte 8 of the profile
config = `255` ("effect: backlight off"), or byte 9 (brightness) = `0`.

## The Fn key

`Fn` (keymap position 26) is not an ordinary key but a layer switch: the
entry is `F0 FF 01`, that is "while held, global layer 1 is active"
(profile 1, layer 1). There are 12 layers in all — 3 profiles × 4 layers —
and any of them can be put on any key.

## The Fn layer (profile 1, layer 1)

| Combination | Action |
| --- | --- |
| `Fn` + `Esc` | `` ` `` |
| `Fn` + `1` … `6` | F1 … F6 |
| `Fn` + `Tab` | factory reset (hold for 3 s) |
| `Fn` + `Q` | profile 1 |
| `Fn` + `W` | profile 2 |
| `Fn` + `E` | profile 3 |
| `Fn` + `R` | indicator LED brightness + (step 20, wrapping) |
| `Fn` + `S` | lighting speed + (wrapping 0→4→0) |
| `Fn` + `T` | N-Key Rollover |
| `Fn` + `A` | colour − |
| `Fn` + `D` | **backlight off** |
| `Fn` + `G` | the side LED (to the right of "6") on/off |
| `Fn` + `Z` | brightness − |
| `Fn` + `X` | brightness + |
| `Fn` + `C` | lighting effect − |
| `Fn` + `B` | recalibration (internal code `254`) |

Layers 2 and 3 of the first profile are empty.

## How the functions were identified

Codes `27`, `28`, `56` and `254` appear neither in the vendor documentation
nor in anyone else's work on this OEM platform. They were pinned down on a
live device, by watching which config byte a keypress changes and what the
keyboard sends on the vendor channel.

The results:

| Code | Config byte | Behaviour |
| --- | --- | --- |
| `28` | 25 (indicator brightness) | 20 → 40 → 60 → 80 → 100 → 20 |
| `56` | 10 (lighting speed) | speed 0 → 1 → 2 → 3 → 4 → 0 |
| `27` | — | turns the indicator LED off and on, not written to memory |
| `254` | — | recalibration; changes nothing in the config and sends no reports |

`Fn+S` does nothing visible while the main backlight is off (byte 8 = 255):
the speed changes, but there is nothing to show it on. That is precisely
what confirms code `56` belongs to the main backlight.

Visually `Fn+R` looks like a cycle of blinking colours alternating with a
dark LED: the indicator effect does not actually change (byte 24 stays on 1,
colour cycle), only the brightness switches, and at the dimmest step the LED
looks off.

That also revealed what the asynchronous `0xA1` report is for: it announces
a change of the active layer, with byte 1 as the layer number (`01` while
`Fn` is held, `00` on release).
