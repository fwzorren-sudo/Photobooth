# Quinceañera Photo Booth

A kiosk photo booth that runs in a browser. Stand an iPad in a corner, and
guests take their own photo strips, single shots and looping boomerang GIFs
with filters and props — no attendant, no app store, no accounts.

Everything happens on the device. Nothing leaves the iPad unless you
deliberately wire up the photo handoff below, and the whole thing works
offline after the first load.

## Use it

Open the page and allow the camera once. The booth is three screens, with one
decision on each, and nothing is ever drawn over the photo except the countdown.

1. **Welcome.** One big card for each thing the booth can make:
   - **Tira de fotos** — a classic 4-shot strip with a countdown between shots
   - **Una foto** — a single framed photo
   - **Boomerang** — a looping GIF, encoded in the browser
   - **Mensaje** — a short video message

   A Spanish / English toggle sits in the corner. The booth shows one language
   at a time, so every label is big enough to read from arm's length.
2. **Camera.** The live picture and one round shutter button. The controls sit
   in a solid rail beside the photo on a landscape tablet, and underneath it on
   a phone, so they never cover anyone. *Filtros* opens the seven looks.
3. **Result.** The keepsake, large, and beside it: how to take it home,
   **Coronas y más**, **Firmar**, then *Repetir* and *¡Listo!*.

### Props

Props go on **after** the photo, not before. *Coronas y más* opens each frame
on its own, as large as the screen allows. Each category leads with real
artwork — crowns, tiaras, a sash, a sceptre, a masquerade mask — and falls
back to emoji after it. Drop your own in [`props/`](props/README.md): a file
plus a line of JSON, no code change.

- **Tap a crown and it lands on a head.** The faces in the frame are found in
  the background and crowns, tiaras and masks are fitted to them — right size,
  right angle, one per person. Everything is measured in eye-widths, so
  leaning towards the lens gets you a bigger crown and a tilted head gets a
  tilted one. Anything can still be dragged, pinched and turned, and
  double-tapped away. If no face is found the prop simply lands in the middle.
- **Poner en todas las fotos** copies a frame's props to the rest of a strip,
  re-fitting them to wherever each person stands in each frame. Or decorate
  the four frames differently, one at a time.

Props are **data, not pixels**: nothing is burned in until the keepsake is
published.

They used to be placed over the live camera too. That looked like the fun part
and was the worst part: a crown sat frozen mid-screen while the people under
it moved, and whatever they managed was stamped identically on all four frames.

Face detection is BlazeFace via TensorFlow.js, vendored under `vendor/tfjs`
so it needs no network. It loads lazily, the first time the props screen
opens, and if it cannot load — or finds nobody — props are placed by hand. It
is a convenience, never a dependency.

Open [`facecheck.html`](facecheck.html) to see what the detector sees: the box,
the landmarks, and a crown placed by the same code the booth uses. Worth
running in the actual room, under the actual lighting, before the party.

### Signing

**Firmar** lets a guest sign with a finger. It opens a wide band by default,
because the whole strip scaled to fit a tablet is about an inch and a half
across — far too small to write anything legible on. The handwriting is
composed inside the keepsake's own border. *Sobre la foto* is there for anyone
who would rather write across the photos themselves, at full width with the
strip scrolling under their hand.

### Taking photos home

The result screen leads with whichever of these is set up:

- **Photo handoff.** Point `upload` at a small Worker (not included here), give
  it its key in `ukey`, and each finished keepsake gets its own QR code. A
  guest scans it and the photo opens on their phone. The QR goes up
  immediately, before the upload finishes, and a line under it says whether a
  scan will work this second. If the Wi-Fi is out, the scan opens a page that
  waits by itself; the photo is kept on the device, retried, and appears there
  once the booth is back online.
- **Shared album.** Set `album` to a shared-album link and the QR points there
  instead. One scan, every photo from the night — but only if somebody
  actually uploads them afterwards; the booth does not fill it.
- **Neither.** A single *Enviar a mi teléfono* button opens the share sheet
  (AirDrop, Messages). Nothing is ever sent anywhere on its own.

The booth never offers to save to itself: that helps the tablet, not the guest.

### The rest

There is a **video guestbook** mode for a short spoken message, and a
**monogram** image (picked in the admin panel) drawn as a crest above the name
on everything the booth makes. The monogram stays on the device — it is never
committed here.

The countdown sits at the top edge of the picture, next to the lens, so guests
look up at the camera instead of down at the controls, and the controls step
out of the way while it runs. There is deliberately no spoken or beeping
countdown: the booth lives in a room with a DJ. If one frame of a strip comes
out badly, tapping that thumbnail reshoots **just that frame** and keeps the
rest.

Between guests the welcome screen shows the night's most recent keepsakes —
which is what actually builds a queue. A small corner chip warns whoever is
running the booth (and only them) about a flat battery, low storage, Wi-Fi
dropping out, or the camera being taken by another app.

The booth returns itself to the welcome screen after 45 seconds of inactivity,
closing any editor left open, so the queue keeps moving.

## Set it up for your event

Everything is configured from the URL, so there is nothing to edit or rebuild:

```
?name=Sof%C3%ADa%20Isabel&date=15%20de%20Marzo,%202026&tag=%23SofiaQuince
```

| Parameter | Example | What it does |
|---|---|---|
| `name` | `Sof%C3%ADa%20Isabel` | Name on the welcome screen and every strip |
| `date` | `15%20de%20Marzo,%202026` | Shown under the name |
| `tag` | `%23SofiaQuince` | Strip footer (`%23` is `#`) |
| `theme` | `light` or `dark` | Booth chrome; the keepsake stays light either way |
| `accent` / `secondary` | `%232F86BF` | Override the theme colours, `#RRGGBB` |
| `album` | `https%3A%2F%2Fphotos.app.goo.gl%2F…` | Shared-album link; shown as a QR on the review screen |
| `upload` | `https%3A%2F%2F….workers.dev` | Photo-handoff Worker; gives each photo its own QR |
| `ukey` | `…` | Key the booth sends with an upload |
| `pin` | `1515` | PIN for the settings panel |
| `countdown` | `3` | Seconds before each shot (1–10) |
| `shots` | `4` | Photos per strip (2–6) |
| `idle` | `45` | Seconds before the booth resets (15–600) |
| `lang` | `es` or `en` | The language the booth opens in. Guests can switch on the welcome screen |
| `slideshow` | `0` | Set to `0` to keep tonight's photos off the welcome screen |
| `video`, `sign` | `0` | Set to `0` to hide the video guestbook or signing |
| `strip`, `single`, `boomerang`, `share` | `0` | Set to `0` to hide that option |
| `print` | `1` | Shows a Print button (AirPrint). Off by default: only useful with a printer there |

URL-encode accents and spaces. Anything you leave out keeps its default.

`ukey` is not a secret. It ships in the page of any booth that uses it, so
treat it as a nuisance filter rather than a lock, and give the Worker its own
narrow permissions.

The booth is light blue and white with gold trim out of the box. Leave
`accent` and `secondary` off unless you want different colours; `theme=dark`
switches the on-screen chrome to deep blue for a dimly lit venue, while the
printed strip stays light because that is what looks right on paper.

### On the iPad

Open the configured URL in Safari, then **Share → Add to Home Screen**. It
launches full-screen with no browser chrome. Managing a fleet? Push it as a
Web Clip profile from your MDM instead.

Before the party: open it once so everything caches (the face model is about
1.5MB and only downloads once), allow the camera, and put the iPad on Do Not
Disturb. Use **Guided Access** (Settings → Accessibility → Guided Access) to
lock guests into the booth — triple-click the top button to start it.

### Operator settings

**Tap the small gear in the bottom-right corner of the welcome screen**, or
press and hold the top-left corner of any screen for three seconds, and enter
the PIN (default `1515`). You can change the name, date, hashtag, the language
the booth opens in, colours, modes, countdown and shots per strip on the device. Those
edits override the URL until you tap *Reset*.

## Run it locally

```bash
python3 serve.py       # http://localhost:8000
```

Browsers only grant camera access on a secure origin. `localhost` counts as
one; anything else needs real HTTPS.

## Tests

```bash
node gif.test.js
```

The GIF encoder is written from scratch — a fixed 216-colour cube with ordered
dithering and a variable-width LZW coder — so boomerangs work with no external
library and no network. The tests round-trip the coder against an independent
decoder (including the dictionary-overflow and code-width-growth paths), then
encode a full GIF and decode it back to confirm every frame matches the
quantizer byte for byte.

The browser-level tests — every screen driven the way a guest drives it, on
six screen sizes, with a fake camera — live with the private build. One thing
they cannot cover: **no camera in a build environment contains a real face**,
so whether the detector actually finds one in your room is what
`facecheck.html` is for.

## Notes

- Guest-facing text exists in Spanish and English; the booth shows one at a
  time, opens in whichever `lang=` or the settings say, and lets a guest switch.
- Designed for a landscape iPad; on a phone the controls move under the photo.
- The preview and the saved photo run through the same render path, so the
  look a guest picks on screen is exactly what comes out.
- Keepsakes are kept on the device (IndexedDB) so the welcome-screen slideshow
  and the upload queue survive a reload. Clearing site data clears them.
