# Tap Watch E17

A lightweight, community-led website showing which pubs in Walthamstow (E17) have which beers on tap.

- **Find a beer:** type a beer name and see nearby pubs that pour it, sorted by distance, with how recently that was checked.
- **Check a pub:** tap a pub to see its regular beers, each with its own "last checked" date.

Draught only. No accounts, no tracking cookies, and your location never leaves your device.

Live at <https://tap-watch.gage-tristan.workers.dev>.

## Status

Phase 1 (static prototype), plus location. Search, the pub list and pub pages work from a sample data file, with distances from your location or a postcode. **The tap lists are made up** and the site says so.

## How it's built

- **Hosting:** Cloudflare Workers with static assets (free plan). Pushing to `main` on GitHub deploys automatically. Wrangler runs the build first.
- **Site:** plain TypeScript and CSS, bundled by Vite. No UI framework.
- **Data:** `public/data/snapshot-e17.json`, made by the scripts in [`seed/`](seed/README.md).
- Coming in later phases: an API under `/api/*`, a Cloudflare D1 database, a map, and a private R2 bucket for photos waiting to be checked.

## Folders

| Path | What's in it |
|---|---|
| `index.html`, `404.html` | The pages |
| `src/` | TypeScript and CSS for the site |
| `src/ui/` | The search box, results list and pub sheet |
| `public/` | Files served as they are: data, fonts, icon, security headers (`_headers`) |
| `seed/` | Scripts and files for loading pubs and beers ([how to use them](seed/README.md)) |

## Commands

You need Node.js (installed with `brew install node`). Run `npm install` once first.

| Command | What it does |
|---|---|
| `npm run dev` | Runs the site on your computer at <http://localhost:5173>, reloading as you edit |
| `npm run check` | Checks the TypeScript for mistakes |
| `npm run build` | Builds the site into `dist/` |
| `npm run preview` | Builds, then runs it the way Cloudflare will (security headers, 404 page) at <http://localhost:8787> |
| `npm run seed:pubs` | Fetches pubs from OpenStreetMap for review |
| `npm run seed:map` | Opens a map of the pubs in the review file |
| `npm run seed:sample` | Rebuilds the sample data file |

## Security

Never commit secrets such as passwords, API tokens or salts. They belong in Cloudflare secrets (or a local `.dev.vars` file, which git ignores).

## Credits

Pub names and locations © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the Open Database Licence. Postcode lookups by [postcodes.io](https://postcodes.io) (only when you type a postcode; your device location never leaves your browser). Headings use Bricolage Grotesque under the SIL Open Font License (see `public/fonts/`).

## Licence

To be decided.
