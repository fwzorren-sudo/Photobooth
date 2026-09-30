# Artwork props

PNGs with an alpha channel that guests can place on a photo, either at the
camera or afterwards with **Decorar** on the review screen.

## Adding one

1. Drop the file in this folder. Any format the browser decodes, as long as it
   has a real alpha channel. **WebP for photographic artwork** - the four
   crowns here are 150-250KB each as lossy WebP against 500-750KB as PNG, and
   the alpha channel comes through byte-exact. **PNG for flat or vector-ish
   art**, where it is already small and lossless.
2. Add a line to `manifest.json`:

   ```json
   { "src": "my-prop.png", "label": "Mi accesorio", "sub": "My prop",
     "category": "corona" }
   ```

   `category` is one of `corona`, `cara`, `fiesta`, `amor`. An unknown value
   makes a new category, using `label`/`sub` as its name.
3. Reload the booth. Artwork leads each category's row, ahead of the emoji.

Nothing else to change - no code edit, no rebuild.

## Anchors: making it land on the face

Give a prop an `anchor` and **A la cara / Fit to face** will put it where it
belongs, at the right size and angle, on every face it finds:

```json
{ "src": "my-crown.png", "label": "Corona", "category": "corona",
  "anchor": { "at": "crown", "seat": 0.93 } }
```

`at` picks the feature:

| `at` | where it goes | for |
|---|---|---|
| `crown` | above the hairline | crowns, tiaras, hats |
| `eyes` | across the eye line | glasses, masks |
| `nose` | just under the nose | mustaches |
| `mouth` | on the mouth | lips |
| `chest` | below the chin | sashes, banners |
| `beside` | off to one side of the head | speech bubbles |

**`seat` is the one you have to get right.** It says which part of *your
artwork* touches the face, as a fraction from the top of the image. A crown
whose band sits 93% of the way down the image has `"seat": 0.93`. Get it wrong
and the crown floats above the head or swallows it.

To measure it: find the lowest solid pixel in the middle fifth of the image -
for a crown or tiara that is the part of the band that meets the top of the
head - and divide its y by the image height. An image editor's eyedropper does
this fine. Then *look at it on a head* before believing it; the numbers here
were each checked against a rendered head at several tilts.

Two things that will mislead you while tuning:

- **Trim the empty margin first.** These four arrived as 784x1168 with the
  crown occupying about 700x550 of it. `seat` is a fraction of the image, so
  any transparent border throws it off.
- **Draw your reference head with real proportions.** The top of the skull is
  about **1.8 eye-widths** above the eye line, and the head is about **2.3
  eye-widths** wide. A head drawn flatter than that makes every crown look
  like it is floating, and you will "fix" a `rise` that was already right.

`width` (in eye-widths), `rise` (up the face) and `side` (across it) override
the defaults if a prop needs nudging. `faces.js` lists what each anchor
defaults to.

A prop with no `anchor` is never auto-placed - it just drops in the middle for
the guest to position, which is right for confetti and hearts.

Everything scales off the distance between the eyes, so a guest leaning towards
the lens gets a bigger crown, and a tilted head gets a tilted one.

## Rules that actually matter

- **Serve it from the booth.** A prop loaded from another domain taints the
  canvas, and the browser then refuses to hand back the finished photo at all.
  The guest would lose the keepsake, not just the prop. Keep files here.
- **Size them generously.** Props are drawn at up to 80% of the frame height on
  a 1440px-wide capture, and a single photo composes 15% larger again - so the
  ceiling is about 850px tall. **1200px on the long side** never goes soft;
  900px is fine unless a guest pinches something to fill the frame. Buy the
  largest the artist ships and scale down, never up.
- **Leave no background.** Transparency is the whole point; a white box around
  a crown looks like a sticker of a crown.
- **Aspect ratio is read from the file**, so the manifest never has to state it.
  A prop that loads wrong is dropped from the palette rather than shown broken.

## Where these came from

The four crowns and tiaras are real artwork, supplied and dropped in. They are
about 700x550 after trimming - enough for any sensible size, very slightly soft
only if a guest pinches one to fill a whole single photo.

The rest (`sash`, `mask`, `mustache`, `lips`, `bubble`) are drawn here;
`src/*.svg` are their sources and `src/rasterize.js` re-renders them at 900px
on the long side with a transparent background. They are stand-ins, and
replacing one needs nothing but steps 1-3 above. The crown and tiara I had
drawn are gone: the real artwork superseded them.
