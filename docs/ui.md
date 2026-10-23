# The interface

Everything read from the keyboard lives in `state.device`; the user's edits
are a draft (`state.draft`) of the same shape on top of it. Nothing reaches
the device until it is written, either with "Write to keyboard" or by
auto-save, and every write is read back and compared byte for byte before it
counts as done (`HE30Device.writeBank`). After a write the whole profile
is read again, so the draft always starts from what the keyboard really
holds.

## Connecting and the toolbar

- If permission for the keyboard was granted before, the page connects on
  its own at load. A failure there is shown, not silently swallowed.
- On connect the editor opens the profile the keyboard is working in, not
  always the first one.
- Only one device operation runs at a time. While one runs, the toolbar and
  the profile and layer selectors are locked and a busy label shows its
  progress. Two operations at once would scramble each other's replies
  (see "Writing" in [protocol.md](protocol.md)).
- Errors appear in the toolbar's status line, where they cover nothing and
  are visible with or without a keyboard; they clear after eight seconds.
  Unhandled promise rejections go to the log.
- Status text lives in a slot that shrinks and truncates, and the toolbar
  never wraps (it scrolls sideways on a narrow window), so a long busy label
  cannot push the page down.
- Confirmations use an in-page `<dialog>`, not `window.confirm`: native
  dialogs block the whole tab, do not appear in screenshots and get in the
  way of automated UI checks.
- On unplugging, the workspace closes and the device is still closed, which
  frees the lock that stops two windows talking to the keyboard at once.
- Served over http(s), the page registers a service worker so it keeps
  working offline (see "Offline use").

## Offline use

The service worker precaches the page's files and is network-first: every
request is fetched fresh, with `cache: "reload"` so the browser's HTTP cache
cannot hand back the stale copy being replaced, and the cache is only the
fallback offline. Cache-first with a background refresh would mix versions
after an update — a new `app.js` next to an old stylesheet and dictionary.
Translations are precached from `locales/index.json`, so adding a language
does not touch the worker. The cache is named `openhelity-dev` in the
repository; the deploy stamps it with the commit, so every release replaces
the previous cache. `tests/sw.test.mjs` checks that every page file is
precached.

## Following the keyboard's profile

Profile switches made on the keyboard (Fn + Q / W / E) are followed at once
from the layer reports it sends, and once a second by asking, in case a
report was missed. The poll is skipped while a device operation runs or the
page is hidden; a failed poll is simply retried by the next.

The editor follows only when the keyboard's own profile changes, so another
profile can still be opened here for editing. With unsaved edits it stays
where it is and says so, rather than dropping them. The profile selector
marks the one the keyboard is in.

## Writing and auto-save

- The first write ever asks the user to accept a disclaimer; the answer is
  remembered in `localStorage` (in private mode it is asked every session).
- The Write button counts the banks the pending changes touch, and the
  confirmation lists them. Writing the travel bank takes about a minute
  (see [protocol.md](protocol.md)), so its progress label says so.
- Auto-save writes without confirmation. With it on, the Write button is
  hidden and the status line shows a state rather than an event: either
  everything is saved or there are pending changes. A timestamp would add
  nothing.
- The write is deferred by three seconds after the last edit, so a run of
  edits becomes one write; starting the slow travel write on every slider
  movement would freeze the interface.
- The countdown does not start until a continuous interaction ends. A slider
  or colour picker fires `input` on every intermediate value and `change`
  once, on release; counting from `input` would keep resetting the timer and
  could still capture a random intermediate value.
- If the timer fires while the device is busy (for example between the end
  of a write and the re-read of the profile, when the edits still formally
  count as unsaved), it waits and tries again instead of failing with
  "keyboard busy".

## Backups

Every successful profile read stores a snapshot of the profile's raw banks —
config, the four keymaps, travel, macros, colours and the three advanced-key
banks — in `localStorage`, keyed by the keyboard's product ID and the profile. The
five most recent snapshots are kept: with only one, the read that follows a
write would overwrite the pre-write state, which is the whole point of the
backup. A snapshot identical to the newest one is not stored again.
Snapshots live only in this browser and disappear with its site data; the
JSON export is the durable copy.

"Restore" offers the snapshots by date and writes the chosen one's raw banks
back, then reads the profile again.

## Copying settings

Copy takes a single layer, all layers, the travel settings or the lighting
from any profile (and layer) into the profile being edited. The source is
read from the device when it is another profile, without touching the
draft; the destination is always the current draft, so the copy stays
undoable and reaches the keyboard only together with the other changes.
Copying lighting carries the raw config across too, since it holds bytes
whose meaning is unknown. Copying something onto itself is refused.
Keys that run a macro or an advanced key keep their slot numbers when copied;
the macro and advanced-key banks themselves are not copied, so across
profiles such keys point at whatever the target profile holds in those slots.

## Export and import

An exported file holds the profile as read from the device: the raw banks,
which are the source of truth when loading it back, and a readable copy of
the settings, layers, travel and macros, so the file can be eyeballed.

Import validates every bank's size and that every value is a byte, then
loads the file into the draft only. Auto-save is switched off first and
writing stays a human decision; otherwise someone else's file would land on
the keyboard before anyone had looked at it. The file input is cleared after
each pick so the same file can be picked again.

## Sliders and value fields

Range inputs do not follow the cursor position. Natively the actuation
point packs 400 steps into about 180 pixels, so hitting exactly 1.00 mm with
a mouse is impossible. Instead, dragging works like an Ableton knob: each
pixel is worth a fixed amount, moving up or right increases, down or left
decreases, and Shift slows it down fourfold. The amount per pixel is scaled
so a full sweep takes about 240 pixels, otherwise a short scale such as speed
0–4 would be far too twitchy; a slider can set its own with
`data-per-pixel`, and `data-vertical="down"` makes a vertical slider follow
the pointer downwards. A click without dragging changes nothing, so a stray
poke at the scale does not disturb the setting. The cursor (`ns-resize`)
hints at the dragging.

Because native dragging is suppressed, so is the native `change`; the slider
dispatches one itself when the drag ends, since auto-save relies on it.

Next to a slider, a text field takes an exact value: Enter or leaving the
field applies it, Escape cancels, and an unparseable entry puts back what
was shown. A comma works as the decimal point. Travel fields are in
millimetres while the draft holds hundredths.

## The keyboard diagram

- Keys are selected with a brush: hold the button and sweep across the
  keys. The first key touched sets the mode: if it was not selected the
  brush selects, if it was the brush deselects, so one motion both adds and
  removes. Shift-click selects a range from the lowest selected key. A click
  on the background clears the selection. The diagram captures the pointer,
  so keys get no pointer events of their own while sweeping; the key under
  the pointer is found with `elementFromPoint`.
- Edits apply to the whole selection. A control whose value differs across
  the selection shows "mixed".
- A selection belongs to the section it was made in. Switching sections
  clears it, otherwise it would silently receive the next section's edits.
  Switching also drops a half-configured advanced key (nothing was saved)
  and stops a macro recording or key entry.
- Not every section shows the diagram: for shortcuts, settings and the log
  it would only take up room. Each section that does can overlay its own
  view on it: stored colours as a bar along the bottom of each key, the
  actuation line, Rapid Trigger values, keys carrying an advanced feature or
  a macro.
- A key whose assignment differs from its keycap legend shows the
  assignment highlighted; changed keys and changed colours are marked.
- Without a keyboard the section navigation is disabled.
- Space, the arrows, Page Up / Down, Home and End do not scroll the page
  outside input fields: people press keys on the very keyboard they are
  watching.

## Key tester

A box next to the diagram shows what the keyboard sends: held keys live,
and each keystroke, mouse button or wheel notch as an entry that stays
readable for most of three seconds and then fades out (at most twelve are
shown). It listens whenever the diagram is on screen, with no click to arm
it, but steps aside while a field or a dialog has the keyboard, and it never
cancels a key, so typing and shortcuts work as usual. Names come from the
same tables as the remap catalogue. Modifiers are also taken from the
event's own flags, in case their keydown was missed; held keys are cleared
when the window loses focus, since a key released elsewhere never sends its
keyup here. Mouse buttons and the wheel are recorded while the pointer is
over the tester, one entry per wheel notch rather than per pixel.

Each keystroke is also tagged with the depth at which the key fired, from
the telemetry stream. A plain key's keymap entry (`10 <modifier mask>
<usage>`) is how telemetry names it. Samples arrive about every 15 ms and a
fast press covers more than a millimetre in that time, so the depth is
interpolated by time between the sample before the keystroke and the next
one; if no further sample arrives within 200 ms the last one is used.
Without telemetry for that key in the last second (the stream is off, or the
key is mapped elsewhere) nothing is shown.

## Press indicator and telemetry

The telemetry stream starts right after every profile read and lives as
long as the keyboard is connected. It is plain feedback ("I can see what was
pressed and how deep"), not diagnostics: each key shows a fill and its depth
as a percentage of the 3.8 mm switch travel.

The stream is switched on by the Dynamic Display bit in the profile config,
and the keyboard streams only from the profile it is working in (see
"Key-travel telemetry" in [protocol.md](protocol.md)). So the bit goes on
that profile, whichever one is open for editing, and opening another profile
to edit writes nothing. When
the keyboard switches profile, the bit is cleared on the old one and set on
the new one. The check runs after every read, because restoring a backup or
importing a file can clear the bit while the listener is still attached.

The bit lives in the same bank as the settings, so it is mirrored into both
the read state and the draft of the edited profile; otherwise it would look
like an unsaved edit and auto-save would switch it back off.

Disconnecting with the button clears the bit. If the tab is closed or the
keyboard is unplugged, nothing can clear it, and it stays set on the device.

## Remap

The assignment catalogue is a search box and groups of options that fold
under their title; while searching, every group with a match is open. It is
built from the same tables that decode the keymap, so the list cannot drift
from what the app is able to read. Everything that needs no second parameter
is here; Mod-Tap and SOCD are set up in the advanced-key
editor, which also sets the hold time and the paired key. The advanced-key
editor uses the same catalogue and shares which groups are open.

The "Fn + key" table on the shortcuts section is built from what the layers
actually contain. A missing Fn key on the base layer is reported in the log.

## Lighting

- With the effect off or brightness at zero the keys are dark, while the
  other parameters are still written and silently do nothing. Without a
  hint that looks like a malfunction, so a warning offers a fix.
- Controls the current effect does not use are dimmed: everything while the
  keys are dark; speed and colour while the effect brings its own colours,
  uses per-key colours or is drawn by the host; the colour while multicolour
  is on.
- Per-key colours show only with the Custom effect (0); any other effect
  paints the board itself, which the per-key card says, with a button to
  switch to Custom. The diagram follows a colour change at once; the write
  comes later.
- An effect value the lists do not know is still shown, by number.

## Actuation

The switch drawing next to the actuation slider is a to-scale cutaway, about
the real size of the switch, so the stem shows through. The SVG uses 10
units per millimetre: a 4 mm stem above a 3.5 mm top housing, a 1 mm plate
flange and a 3.5 mm bottom housing. At rest the stem's lower end sits in the
middle of the body, 4 mm above the bottom (y 90); fully pressed it reaches
the bottom (y 130). The stem sinks to the actuation depth, clamped at 4 mm.

A 0–4 mm scale outside the housing measures from the bottom of the switch:
0 there, 4 at the resting lower end of the stem, with plain ticks between.
An arrow on it spans from the bottom up to the stem's lower end. Its heads
are drawn as triangles rather than SVG markers, so their tips land exactly
on the lines they measure between; when there is no room for both heads,
the arrow is drawn without heads rather than with a stub. The scale's digits
have a halo in the card colour so lines behind them do not strike them out.

The vertical slider beside the drawing is sized for the hand (about 2 cm),
not aligned with the drawing: the two share only the value. It grows
downwards and moves 1.5 hundredths per pixel. Its maximum is the deepest
actuation point the firmware holds (see "The unit of the travel values" in
[protocol.md](protocol.md)).

On the diagram each key's actuation point is a dashed line on the same scale
as the press fill (full travel = 100 %), so the key fires where the fill
meets the line. The line stops at 96 % so a bottomed-out point does not sit
on the key's border, and it passes behind the labels rather than through
them.

## Rapid Trigger

- Switches show "mixed" (indeterminate) when the selected keys disagree.
- Split sensitivity is on when any selected key has different press and
  release values, until the switch is used. Joining them again gives release
  the press value; while joined, one slider sets both.
- Turning Rapid Trigger on keeps a key's continuous setting if it had one.
- Sensitivity runs from 0.10 mm to 0.10 mm short of the deepest actuation
  point.
- On the diagram, as Wootility shows it: keys using it are tinted, with the
  press sensitivity top left, the release sensitivity bottom right when it
  differs, and ⟳ when it is continuous.

## Advanced keys

To the user an advanced key is a feature put on a key. The firmware keeps
each feature's settings in a bank slot that the key points at from its
keymap entry (see [protocol.md](protocol.md)); here slots are an
implementation detail. One is taken when a feature is put on a key and
emptied when the last key using it lets go, so a slot never exists without
a key.

- Setting a feature up goes in two steps, as in Wootility: pick the key(s)
  on the diagram, then configure. Only as many keys as the feature takes
  are kept, the latest ones. The first pick fills in the key's own action as
  the default. Where Wootility offers presets, the pick step lists the keys
  that already have this feature.
- Saving first removes the binding being edited (its keys may have
  changed) and anything else on the same keys in that layer, so no slot is
  left dangling.
- SOCD takes two keys; each points at the other, the slot
  holds both keys' own actions, and both keys are put into Rapid Trigger
  (SOCD with the mirrored priority 1 / 2), as the firmware expects.
- Removing a feature gives the keys their actions back. On the base layer a
  key goes back to what it does out of the box, since the tap or toggled
  action may have been changed. A DKS key takes back the plain usage kept in
  its `code2`. SOCD keys leave Rapid Trigger.
- A key pair of type `0x93`, whose behaviour has not been checked on the
  keyboard, is not offered. One set up by another app still holds its slot,
  is listed and can be removed, but not edited.
- Deleting a feature that has not been saved yet just drops it.
- The configure step shows the catalogue (without macros) on the left and
  the feature's slots and settings on the right. A new Mod-Tap starts with
  left Ctrl on hold and a 200 ms hold time.

### The DKS editor

The grid follows Wootility: a row per binding with its key on the left, a
column per event, two under Key Press (down past the first point, down past
the second) and two under Key Release (back up past the second, back past
the first). The two points are edited over the press columns; the release
columns mirror them. A new DKS starts with action 1 held from the first
press point until the last release, a plain key to start from.

Each row's track has a "+" on every free event. Clicking it adds a tap;
dragging a tap or bar to the right holds it until a later event (before the
next press; the last event only takes taps), and a click without dragging
removes it. A hold ends where the column it releases on begins, so that
column's "+" stays free for another press. Column and row sizes are set from
the script as `--dks-column` / `--dks-row`.

The points are edited in real millimetres in 0.2 mm steps, from 0.2 to
4.0 mm; the bank's unit is assumed, not measured (see "DKS" in
[protocol.md](protocol.md)).

## Macros

- On the macro section clicking a key puts the open macro on it in the layer
  shown, or takes it off if it is already there; there is no selection. A
  key carrying an advanced feature gives it up first, so no bank slot is
  left pointing at it. Taking a macro off the base layer gives the key its
  out-of-the-box action.
- The layer selector there is the same as the sidebar's, because the
  diagram shows that layer. Repeat counts beyond the list, as held by the
  firmware, still show.
- Each slot in the list shows the keys it sits on, so a slot in use is easy
  to find. The step limit is shared by the whole profile's bank.
- "+ Key": the next key or combination pressed becomes steps once every key
  of it is released (Ctrl ↓, C ↓, C ↑, Ctrl ↑). Keys a keyboard cannot type
  into a browser (F13 and up, media keys) come from a list instead.
- Recording uses the physical key from `event.code`, so it does not depend
  on the OS layout. Keys are caught before the page sees them, so Space or
  Enter cannot press a button meanwhile; auto-repeat is ignored. Steps
  appear as they come, are appended to the macro on Stop, and the clock in
  the banner ticks on its own between keys. Real pauses are kept unless
  that option is off, in which case the default pause is used.
- The macro is shown as blocks: an action per row ("↓ Press Ctrl") and a
  pause as a block of its own. No block, no pause; a zero pause removes its
  block, and a pause cannot open the macro. The "+ pause" button keeps its
  room when hidden so the rows stay aligned.
- Rows are reordered by dragging their handle: the row follows the pointer,
  the rows it passes slide out of its way, and near the top or bottom edge
  the list scrolls. With the keyboard, ↑ / ↓ on the handle move the row.
- A macro that leaves keys pressed gets a warning with a button to release
  them at the end.

## Layout and styling

- The sidebar holds the profile and layer, the context every section works
  in; actions live in the toolbar. Only the main column scrolls; below
  860 px the layout falls back to a single page that scrolls.
- `[hidden]` is forced with `!important`: any class rule that sets `display`
  outranks the browser's own `[hidden] { display: none }`.
- The key tester uses `contain: size`, so its entries never size it: the row
  takes the diagram's height and the tester fills it.
- Keys use a crosshair cursor because selection is painted with a brush; on
  the macro section, where a click puts a macro on a key, it is a pointer.
- An on/off switch is a styled checkbox; its indeterminate state reads as
  "mixed".
