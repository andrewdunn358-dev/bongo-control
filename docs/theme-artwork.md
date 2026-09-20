# State-driven artwork in a theme

A theme may carry SEVERAL images for a widget and say which one shows
for which reading. VanOS evaluates the rule; the package still contains
no code. This is what lets a designed SET of art (a frame per battery
level) be used as designed, instead of one frame being picked and the
rest discarded.

Write it with the Theme Studio rather than by hand - it packs the files
and checks the rules. The format is here because the Pi enforces it.

## Shape

In `theme.json`, alongside `assets`:

```json
{
  "artwork": {
    "battery": {
      "levels": [
        { "upTo": 20, "image": "assets/bat-20.png" },
        { "upTo": 60, "image": "assets/bat-60.png" },
        { "image": "assets/bat-full.png" }
      ],
      "charging": "assets/bat-charging.png",
      "fill": { "body": "assets/glass.png", "fill": "assets/liquid.png",
                "bottom": 0.86, "top": 0.14 }
    },
    "solar":   { "bands": [ { "upTo": 5, "image": "assets/s-idle.png" },
                            { "image": "assets/s-high.png" } ] },
    "weather": { "conditions": { "rain": "assets/w-rain.png" } }
  }
}
```

- `upTo` is an INCLUSIVE upper bound: percent for battery, watts for
  solar. The last entry may omit it, meaning "anything above".
- `charging` shows while the van is charging, instead of the level
  frame. Omit it and the level frame shows throughout.
- `fill` beats `levels`: the body image is drawn whole and the fill
  image is clipped to the real charge. `top` and `bottom` say where the
  full and empty lines sit in your picture, as fractions from its top
  (0 = very top, 1 = very bottom), so the glass can be any shape.
- `conditions` keys are the words the Weather widget shows, lower-cased:
  clear, partly cloudy, overcast, fog, rain, snow, showers, thunder.

## The rules VanOS applies

1. **A reading the van does not have shows NO artwork.** No state of
   charge (no shunt, or one that has not synchronised) means no battery
   frame at all - not the "empty" one. The widget falls back to VanOS's
   own drawing. Artwork never stands in for a measurement.
2. **A frame the package does not contain is dropped on install**, not
   refused: a theme missing one image loses that image, not its install.
3. **Artwork beats a named drawing.** A theme that sets both for one
   widget gets the artwork; the Studio warns when that happens.
4. **There is no roof artwork, deliberately.** The van has no roof
   position sensor, so no artwork may vary with a position it cannot
   know. One fixed roof image is still allowed as a plain asset,
   because it claims nothing.

## Limits

Per image 5MB, 60 images per theme, 20MB per package, 64MB for all
installed themes. nginx allows a 24MB upload, so the Pi's own limits are
the ones that apply.

## Where the code is

- `frontend/src/lib/artwork.ts` - the rule, and the only place a frame
  is chosen. `frontend/tests/artwork.test.mjs` covers it.
- `backend/app/services/theme_service.py` `_clean_artwork` - what a
  package may contain, checked again on every listing.
- `frontend/src/lib/useThemeArtwork.ts` - supplies the installed theme's
  artwork to widgets, or the Studio draft's while designing.
