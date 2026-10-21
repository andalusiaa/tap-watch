# Brewery logos

Drop one file per brewery here, named after its id in `seed/breweries.json`, e.g. `camden-town.svg`.

- **SVG** is best (sharp at any size, tiny). PNG at 128×128 is fine too; name it `<id>.png` and
  say so in `seed/breweries.json`.
- Square-ish, with a little padding, and readable at 40 px across.
- Logos are shown on a white tile in both light and dark mode, so colour logos are fine and
  white-only ones are not.
- Then set `"has_logo": true` for that brewery in `seed/breweries.json` and run the usual
  `npm run db:beers:remote`. A brewery without a logo shows its initials instead.

Only use a logo the brewery publishes for this purpose, or that they have sent you. Keep the
original shapes and colours: don't redraw or recolour them.
