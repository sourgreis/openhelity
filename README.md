# OpenHElity

An open web configurator for hall-effect keyboards on the G-COME OEM platform.
It runs in the browser over WebHID; all settings are stored on the keyboard.

**Open it:** <https://sourgreis.github.io/openhelity/>

## Supported hardware

The ZUOYA HE30 (`19F5:FD50`), tested with firmware
`HALL_HS_USB_KB, Feb 25 2025`.

Only this USB ID is offered in the connection dialog. Sibling models such as
the EPOMAKER HE30 and GT60 speak the same protocol but have not been tested,
so the configurator does not connect to them — see
[`docs/hardware.md`](docs/hardware.md).

## Browsers

WebHID is available only in desktop Chromium-based browsers: Chrome, Edge,
Opera, Brave and the like. Firefox and Safari do not support it. The page must
be served over `https://` or from `localhost`.

## Features

- keymap across 3 profiles × 4 layers
- per-key actuation point and Rapid Trigger
- live key press depth
- key backlight, per-key colours and the indicator LED
- advanced keys: DKS, Toggle, Mod-Tap, SOCD
- macros recorded from the keyboard
- copying between layers and profiles, backups, JSON import and export

## Documentation

| Path | Contents |
| --- | --- |
| [`docs/protocol.md`](docs/protocol.md) | the USB protocol and the memory banks |
| [`docs/ui.md`](docs/ui.md) | how the interface behaves |
| [`docs/shortcuts.md`](docs/shortcuts.md) | the keyboard's built-in Fn shortcuts |
| [`docs/hardware.md`](docs/hardware.md) | the microcontroller and the OEM platform |
| [`docs/prior-art.md`](docs/prior-art.md) | related projects |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | building, testing, adding a model or a language |

## Disclaimer

OpenHElity is an independent project. It is not affiliated with, endorsed by
or supported by ZUOYA, G-COME or EPOMAKER; their names are used only to say
which hardware this works with, and all trademarks belong to their owners.
The protocol was worked out independently for interoperability.

Writing settings changes what is stored on the keyboard. The software is
provided as is, without warranty of any kind — use it at your own risk.

## License

[MIT](LICENSE). The licences of the Rust crates compiled into the page are
published with it, in `pkg/THIRD-PARTY-NOTICES.txt`.
