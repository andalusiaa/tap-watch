# Brewery logos

Drop one file per brewery here, named after its id in `seed/breweries.json`, e.g. `camden-town.svg`.

- **SVG** is best (sharp at any size, tiny). PNG works too: save it square at about 96×96,
  which keeps it under 20 KB.
- Square-ish, with a little padding, and readable at 40 px across.
- Logos are shown on a white tile in both light and dark mode, so colour logos are fine and
  white-only ones are not.
- Nothing else to set: the file being here is enough. Run the usual `npm run db:beers:remote`
  and it appears. A brewery without a logo shows its initials instead.
- Keep the full-size original in `seed/raw/logos-original/` (not published).

Only use a logo the brewery publishes for this purpose, or that they have sent you. Keep the
original shapes and colours: don't redraw or recolour them.
