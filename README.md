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
| `accent` / `secondary` | `%23E6338C` | Theme colours, `#RRGGBB` |
| `pin` | `1515` | PIN for the settings panel |
| `countdown` | `3` | Seconds before each shot (1–10) |
| `shots` | `4` | Photos per strip (2–6) |
| `idle` | `45` | Seconds before the booth resets (15–600) |
| `strip`, `single`, `boomerang`, `print`, `share` | `0` | Set to `0` to hide that option |

URL-encode accents and spaces. Anything you leave out keeps its default.

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
