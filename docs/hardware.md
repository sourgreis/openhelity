# The hardware: which chip the HE30 runs

Short answer: a **WCH CH32V30x-class RISC-V microcontroller** — QingKe V4 core,
USB 2.0 High-Speed, the CH32V305 / CH32V307 family.

This was established by reading the firmware image out of the vendor flasher,
not by opening the case. The exact part number needs the marking on the chip.

## Where the firmware image is

The flasher `HE30_CS67B88FCE_V110_20241213.exe` carries the firmware inside
it. Its build string sits at file offset `0x253854`:

```
HALL_HS_USB_KB  Dec 13 2024  16:56:35
```

The HE65 flasher carries the same firmware built 14 minutes earlier
(`16:42:55`, signature at `0x251e60`), so the two models share one code base —
as the shared `layouts/` folder in the vendor driver already suggested.

The RISC-V code occupies roughly `0x240000`..`0x254000` of the executable,
about 80 KB. Everything below is measured on that region.

## Why RISC-V

The bytes around the build string are full of `82 80`, which is `8082` little
endian — `c.jr ra`, the RISC-V compressed `ret`. Decoding further gives
`addi`, `auipc` and `sw` in the RV32 encoding. It is not an ARM image.

## The memory map

Every `lui rd, imm` in the code region, paired with the load or store that
follows it, resolves to a concrete peripheral register. The counts below are
how often each address is referenced — at register level where the pairing
succeeded, at page level otherwise:

| Address | What it is | References |
| --- | --- | --- |
| `0x40023400` | **USBHS** — the USB 2.0 High-Speed device | 82 |
| `0x40023800` | **EXTEND (EXTEN)** — a register block STM32 does not have | 2 |
| `0xE000E000` | **PFIC** — the interrupt controller | 16 |
| `0x40021000` | RCC — clocks | 91 |
| `0x40012400` | ADC1 — reading the hall sensors | 23 |
| `0x40010400` | EXTI — matches the `Run at EXTI` string in the image | 17 |
| `0x40020000`, `0x40020400` | DMA1, DMA2 | 83, 17 |
| `0x08000000` / `0x20000000` | flash / SRAM | 27 / 73 |
| `0x45670123` | the flash unlock key — this is how the config banks are written | 2 |

## Why that means WCH

The map is STM32's: flash at `0x08000000`, SRAM at `0x20000000`, peripherals
at `0x40000000`. But the core is RISC-V, and the interrupt controller sits at
`0xE000E000` — where a Cortex-M keeps its NVIC. That combination is WCH's
signature: their QingKe core deliberately mirrors the Cortex-M layout so that
STM32 code ports across. A Nuclei-based RISC-V part (GD32VF103, say) puts its
ECLIC at `0xD2000000` instead.

`EXTEND` at `0x40023800` seals it: that block is CH32V-specific — it is where
the USBHS PHY PLL, the HSI trim and the LDO are configured. There is no such
peripheral on an STM32.

`USBHS` at `0x40023400` narrows the family to the members that have a
High-Speed device with an internal PHY — CH32V305, CH32V307, CH32V208. It also
explains the `HS` in `HALL_HS_USB_KB` and the advertised 8000 Hz polling rate:
full-speed USB tops out at 1000 Hz, so anything above it needs High Speed.

CH32V208 is the BLE part; this keyboard is wired only, and nothing in the image
touches a radio. That leaves CH32V305 / CH32V307, which differ mainly in
Ethernet — not something a keyboard uses, and therefore not something the
firmware can be made to reveal.

**To pin the part number down, open the case and read the marking.** Expect
something of the shape `CH32V307VCT6`.

## Reproducing this

```python
# in the directory holding the vendor flasher
d = open("HE30_CS67B88FCE_V110_20241213.exe", "rb").read()
code = d[0x240000:0x254000]
for i in range(0, len(code) - 4, 2):
    w = int.from_bytes(code[i:i+4], "little")
    if w & 3 == 3 and (w & 0x7f) == 0x37:      # lui rd, imm20
        print(hex(w & 0xfffff000))             # histogram these
```

## The OEM platform

The vendor driver's `config.xml` declares `device_type="101"`, a number from
the series used across the web drivers hosted at **`keybord.net.cn`**. That
domain is registered to **深圳市果来微科技有限责任公司** (Shenzhen Guolaiwei
Technology). "果来" transliterates roughly as **G-COME** — which is exactly the
USB manufacturer string this keyboard reports. So G-COME is the ODM, and ZUOYA
is a brand printed on its hardware.

Certificate transparency logs list more than eighty per-brand subdomains of
`keybord.net.cn`:

> zuoya, epomaker, drunkdeer, cherry, varmilo, redragon, machenike, mchose,
> rk (Royal Kludge), qwertykeys, luminkey, keydous, kzzi, darmoshark,
> thunderobot, vortex, bloody, xvx, flesports, iconika, glacier, savage,
> titan, zenaim, vspo, gcomemouse, sdardamouse, …

A shared driver portal is not by itself proof of shared silicon — some of those
brands are mice, some are ordinary mechanical keyboards. What is confirmed at
the protocol level is the table below.

Both checks are repeatable: `whois keybord.net.cn` for the registrant, and
<https://crt.sh/?q=%25.keybord.net.cn> for the subdomain list. The vendor ID
is absent from <http://www.linux-usb.org/usb.ids>.

## Confirmed siblings

| Brand | Model | VID:PID | device type | How it is known |
| --- | --- | --- | --- | --- |
| ZUOYA / G-COME | HE30 (the driver also ships HE 65 and HE 80 layouts) | `19F5:FD50` | 101 | captured from a live device, this repository |
| EPOMAKER | HE30 | `19F5:FB27` | 102 | `z750sasr/epomaker-he30-alternate-web-driver` |
| EPOMAKER | HE30, later revision | `19F5:FB4C` | 104 | same |
| EPOMAKER | GT60 | `19F5:FB79` | 105 | same |
| DrunkDeer | "gen-2 OEM" variants, e.g. A75 Pro | `19F5:FB5C` | — | `svumo/DrunkDeer-Control`, from a USB capture |

`19F5` does not appear in `usb.ids` at all: it is an unregistered vendor ID the
ODM hands to every brand at once, with the PID and `device_type` telling the
models apart.

## Related projects

**[`z750sasr/epomaker-he30-alternate-web-driver`](https://github.com/z750sasr/epomaker-he30-alternate-web-driver)**
— a WebHID configurator for the EPOMAKER HE30, live at
<https://z750sasr.github.io/epomaker-he30-alternate-web-driver/>. Effectively
this project's twin: the same keyboard down to the key matrix, a different PID,
an independent implementation. It is where the `0x55`/`0xAA` framing, the bank
numbering and the command list came from before any of it was checked against a
live ZUOYA. Worth reading alongside anything here.

**[`svumo/DrunkDeer-Control`](https://github.com/svumo/DrunkDeer-Control)**
(MIT) — a .NET driver for DrunkDeer keyboards. Its
[`docs/keyboard-protocol-gen2.md`](https://github.com/svumo/DrunkDeer-Control/blob/main/docs/keyboard-protocol-gen2.md)
and [`CONTEXT.md`](https://github.com/svumo/DrunkDeer-Control/blob/main/CONTEXT.md)
document what they call the "extended gateway" protocol of the OEM firmware
variants. Its request layout matches ours field for field, as do the
per-profile data at `N × 0x400` and the 8-byte per-key travel records. An
independent confirmation of the format arrived at here, and the source of the
`is_last` reading of byte 7 noted in [`protocol.md`](protocol.md).

**[`deerios/DrunkDeerSDK`](https://github.com/deerios/DrunkDeerSDK)** (MIT) — a
.NET library for DrunkDeer analog keyboards; its
`protocol/base_messages.yaml` is what the project above cross-validated
against.

More context, including the indirectly useful ZUOYA reverse-engineering
projects, is in [`prior-art.md`](prior-art.md).

## What this means for the project here

The configurator was written against a ZUOYA HE30 and talks to it over a
protocol shared by at least three brands and a whole family of `device_type`
values. Support for a sibling model is therefore mostly a matter of a key
layout and a PID, not a new protocol — the reason the vendor driver ships
HE 30, HE 65 and HE 80 layouts against one firmware image.

Firmware of our own would target a CH32V30x: WCH's toolchain is public, the
part is documented, and the bootloader in the flasher is a separate protocol
that has not been worked out.
