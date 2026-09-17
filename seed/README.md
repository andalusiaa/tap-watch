# Seed data

Everything needed to fill Tap Watch with pubs and beers for an area. Repeat these steps for each new area.

## Files

| File | What it is | Who edits it |
|---|---|---|
| `areas.json` | Each area: name, postcode district, borough, centre and search box | Tristan |
| `pubs-<area>.review.csv` | Pubs found in OpenStreetMap, with `include` yes/no | Script writes it once, then Tristan |
| `beers.json` | The master beer list (draught only, regular beers only) | Tristan |
| `operators.json` | Pub companies, breweries and `Free house` | Tristan |
| `raw/` | Downloads the scripts make (not in git) | Nobody |

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

## 2. Check the beer list

`beers.json` is a first draft. Beers with a `check` note need a look: usually the UK draught ABV, or whether the beer is really on tap regularly in the area. Clear the note (`"check": null`) once it's right.

Rules (SPEC section 4):

- Draught only. Never bottles or cans.
- Regular beers only. No one-off guests, seasonals or limited runs.
- `is_alcohol_free` is `true` when the ABV is 0.5% or lower.
- `category` is the style: `lager`, `stout`, `pale_ipa`, `bitter_cask`, `cider` or `other`. Alcohol-free beers keep their style; the site groups them separately.
- `aliases` are other ways people type the name, written in lowercase without accents or apostrophes (for example `"murphys"`, `"guinness zero"`). An alias can only belong to one beer.

The scripts check the list for mistakes (duplicate ids, clashing aliases, ABVs that don't match the alcohol-free flag) and stop with a message if they find one.

## 3. Build the prototype data

```bash
npm run seed:sample
```

This writes `public/data/snapshot-e17.json` from the included pubs and the beer list. **The tap lists it makes are invented**, so every freshness colour can be seen. The site shows a "prototype" banner while this sample file is in use. Phase 2 replaces it with real data from the database.
