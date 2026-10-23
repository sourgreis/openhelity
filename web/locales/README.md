# Translations

English is built into `../js/i18n.js` and into the code tables of
`../js/keys.js`. Everything else lives here, one flat JSON file per language:

```json
{
  "language.name": "Русский",
  "app.connect": "Подключить клавиатуру",
  "mouse.1": "ЛКМ"
}
```

`index.json` is the catalogue the application reads at startup to build the
language menu. It is generated from the files in this directory — do not edit
it by hand.

## Adding a language

```bash
node tools/check-i18n.mjs --new de Deutsch    # creates de.json and lists it
$EDITOR web/locales/de.json                   # translate the values
node tools/check-i18n.mjs                     # check before committing
```

The new file starts out as a copy of the English strings, so translating means
editing values rather than hunting for keys. Nothing else has to change: the
language appears in the sidebar selector on the next load.

## What the keys are

* `language.name` — how the language names itself in the menu. Required.
* `app.*`, `board.*`, `tab.*`, `settings.*` and the rest — interface strings.
  `{name}` placeholders are substituted at runtime and must survive
  translation, though their order may change.
* `mouse.*`, `system.*`, `consumer.*`, `special.*`, `wheel.*`,
  `effect.main.*`, `effect.indicator.*`, `rate.report.*`, `rate.tick.*` —
  names for the protocol code tables in `../js/keys.js`, keyed by the
  firmware code. `check-i18n.mjs` takes this list from `NAME_TABLES` there,
  and the interface strings from `BASE` in `../js/i18n.js`.

A key you leave out simply shows in English, so a partial translation is
perfectly usable; a missing or broken language file leaves the whole
interface in English. A key that is not in the list is an error — `check-i18n.mjs`
reports it, because it usually means a typo that would never be shown.

Key legends (`A`, `F1`, `Space`, `Fn`) are protocol facts, not text: they are
what is printed on the keycaps and are never translated.
