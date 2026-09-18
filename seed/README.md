# Seed data

Everything needed to fill Tap Watch with pubs and beers for an area. Repeat these steps for each new area.

## Files

| File | What it is | Who edits it |
|---|---|---|
| `areas.json` | Each area: name, postcode district, borough, centre and search box | Tristan |
| `pubs-<area>.review.csv` | Pubs found in OpenStreetMap, with `include` yes/no | Script writes it once, then Tristan |
| `beers.json` | The master beer list (draught only, regular beers only) | Tristan |
| `operators.json` | Pub companies, breweries and `Free house` | Tristan |
| `raw/`, `out/` | Downloads and generated SQL (not in git) | Nobody |

## 1. Find the pubs

```bash
npm run seed:pubs
```

This asks OpenStreetMap for every pub (and, for reference, every bar) inside the area's search box. It then asks postcodes.io for each one's postcode district.

It writes `pubs-e17.review.csv`. Open it in Numbers or Excel and check each row:

- **include**: `yes` to list the pub, `no` to leave it out. Pubs outside the postcode district, bars and likely brewery taprooms start as `no`.
- **operator_id**: the pub's operator, using an `id` from `operators.json` (for example `stonegate` or `free-house`). Add new operators to `operators.json` first.
- **notes**: why a row might need a look.

The script never overwrites your edited file. If you run it again, it writes `pubs-e17.review.new.csv` for you to compare.

To see the pubs on a map, run:

```bash
npm run seed:map
```

A map opens in your web browser. Green pins are pubs set to `yes`; grey pins are the other places in the postcode district. Click a pin to see its name. Run it again after editing the CSV to see your changes.

## Updating the beer list (as a spreadsheet)

1. `npm run beers:export` saves the current live list as `seed/out/beer-list.csv`. It includes any beers added on the admin page.
2. Open it in Numbers, Excel or Google Sheets. Add a row for a new beer (leave its ID blank), change any details, or delete a row to take a beer off the list. Style must be one of: Lager, Stout or porter, Pale ale or IPA, Bitter or cask ale, Cider, Other. Separate other spellings with semicolons.
3. Save it as CSV (in Numbers: File → Export To → CSV).
4. `npm run beers:import -- path/to/the-file.csv` checks it and says what was added, changed or taken off.
5. `npm run db:beers:remote` updates the live site. Pubs and tap lists are not touched.

Beers taken off the list are hidden from the site, not deleted, so bringing one back later keeps its history.

## 2. Check the beer list

`beers.json` is a first draft. Beers with a `check` note need a look: usually the UK draught ABV, or whether the beer is really on tap regularly in the area. Clear the note (`"check": null`) once it's right.

Rules (SPEC section 4):

- Draught only. Never bottles or cans.
- Regular beers only. No one-off guests, seasonals or limited runs.
- `is_alcohol_free` is `true` when the ABV is 0.5% or lower.
- `category` is the style: `lager`, `stout`, `pale_ipa`, `bitter_cask`, `cider` or `other`. Alcohol-free beers keep their style; the site groups them separately.
- `aliases` are other ways people type the name, written in lowercase without accents or apostrophes (for example `"murphys"`, `"guinness zero"`). An alias can only belong to one beer.

The scripts check the list for mistakes (duplicate ids, clashing aliases, ABVs that don't match the alcohol-free flag) and stop with a message if they find one.

## 3. Build the map

```bash
npm run map:build
```

This cuts the area (the `map` box in `areas.json`) out of the latest Protomaps build of OpenStreetMap and saves it as small tile files in `public/map/tiles/`. Run it again every few months to pick up map changes. It needs the free pmtiles tool; the instructions are at the top of `build-basemap.mjs`.

## 4. Load the database

```bash
npm run db:seed:local    # your computer's copy
npm run db:seed:remote   # the live database
```

This turns the included pubs, the beer list and the operators into SQL (`out/seed-e17.sql`) and runs it. It is safe to run again: rows are updated, and pubs or beers you have removed are hidden rather than deleted.

It also adds **invented tap lists**, so every freshness colour can be seen, but only while the area is marked as sample data. The site shows a "prototype" banner while that is the case. Once real tap lists are in (Phase 5), the area is switched off sample mode and this step leaves the listings alone.
