# Quinceañera Photo Booth

A kiosk photo booth that runs in a browser. Stand an iPad in a corner, and
guests take their own photo strips, single shots and looping boomerang GIFs
with filters and emoji props — no attendant, no app store, no accounts.

Everything happens on the device. **Photos are never uploaded anywhere**, there
is no backend, and the whole thing works offline after the first load.

## Use it

Open the page, allow the camera once, and tap to start. Guests get:

- **Tira de Fotos** — a classic 4-shot strip with a countdown between shots
- **Foto** — a single framed photo
- **Boomerang** — a looping GIF, encoded in the browser

…plus seven filters and emoji props they drag, pinch and twist onto the frame.
Drop a prop with a tap, double-tap it to remove it.

Set `album` to a shared-album link and the review screen shows a QR code for
it. Guests scan once and get every photo from the night. **This is how guests
take photos home from the web booth** — a static site has no server at the
venue, so it cannot hand a file straight to someone else's phone the way the
native iPad app can.

There is also a **video guestbook** mode for a short spoken message, a
**Firmar** button that lets guests sign their photo with a finger before
saving, and a **monogram** image (picked in the admin panel) drawn as a crest
above the name on everything the booth makes. The monogram stays on the
device — it is never committed here.

Video messages live only in memory in this build, since a static site has no
disk: save or share one before leaving the review screen.

The countdown is spoken out loud in Spanish and a "stand here" oval shows while
guests get into position, so they look at the lens instead of down at the
screen. If one frame of a strip comes out badly, tapping that thumbnail
reshoots **just that frame** and keeps the rest.

Between guests the welcome screen shows the night's most recent keepsakes —
which is what actually builds a queue. A small corner chip warns whoever is
running the booth (and only them) about a flat battery, low storage, Wi-Fi
dropping out, or the camera being taken by another app.

The booth returns itself to the welcome screen after 45 seconds of inactivity,
so the queue keeps moving.

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
| `pin` | `1515` | PIN for the settings panel |
| `countdown` | `3` | Seconds before each shot (1–10) |
| `shots` | `4` | Photos per strip (2–6) |
| `idle` | `45` | Seconds before the booth resets (15–600) |
| `voice` | `0` | Set to `0` to silence the spoken countdown |
| `slideshow` | `0` | Set to `0` to keep tonight's photos off the welcome screen |
| `video`, `sign` | `0` | Set to `0` to hide the video guestbook or signing |
| `strip`, `single`, `boomerang`, `print`, `share` | `0` | Set to `0` to hide that option |

URL-encode accents and spaces. Anything you leave out keeps its default.

The booth is light blue and white with gold trim out of the box. Leave
`accent` and `secondary` off unless you want different colours; `theme=dark`
switches the on-screen chrome to deep blue for a dimly lit venue, while the
printed strip stays light because that is what looks right on paper.

### On the iPad

Open the configured URL in Safari, then **Share → Add to Home Screen**. It
launches full-screen with no browser chrome. Managing a fleet? Push it as a
Web Clip profile from your MDM instead.

Before the party: open it once, allow the camera, and put the iPad on Do Not
Disturb. Use **Guided Access** (Settings → Accessibility → Guided Access) to
lock guests into the booth — triple-click the top button to start it.

### Operator settings

**Press and hold the top-left corner for three seconds** and enter the PIN
(default `1515`). You can change the name, date, colours, modes, countdown and
shots per strip on the device. Those edits override the URL until you tap
*Restablecer*.

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

## Notes

- Guest-facing text is Spanish with an English line underneath.
- Designed for a landscape iPad; it degrades to a stacked layout on phones.
- The preview and the saved photo run through the same render path, so the
  filter and props a guest arranges on screen are exactly what comes out.
