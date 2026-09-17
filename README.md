# Tap Watch E17

A lightweight, community-led website showing which pubs in Walthamstow (E17) have which beers on tap.

- **Find a beer:** type a beer name and see nearby pubs that pour it, sorted by distance, with how recently that was checked.
- **Check a pub:** tap a pub to see its regular beers, each with its own "last checked" date.

Draught only. No accounts, no tracking cookies, and your location never leaves your device.

Live at <https://tap-watch.gage-tristan.workers.dev>.

## Status

Phase 2 (database and votes). Pubs, beers and tap lists live in a Cloudflare D1 database, and "Still on?" votes are saved, with rate limits and spam checks. Distances come from your location or a postcode. **The tap lists are still made up** and the site says so.

## How it's built

- **Hosting:** Cloudflare Workers with static assets (free plan). Pushing to `main` on GitHub deploys automatically. Wrangler runs the build first.
- **Site:** plain TypeScript and CSS, bundled by Vite. No UI framework.
- **API:** a Cloudflare Worker (`worker/`) answers `/api/snapshot` and `/api/vote`.
- **Database:** Cloudflare D1, structure in `migrations/`, data loaded from [`seed/`](seed/README.md).
- **Clean-up:** a daily scheduled job clears device hashes after 30 days and deletes old rate-limit counters.
- Coming in later phases: a map, and a private R2 bucket for photos waiting to be checked.

## Folders

| Path | What's in it |
|---|---|
| `index.html`, `404.html` | The pages |
| `src/` | TypeScript and CSS for the site |
| `src/ui/` | The search box, results list, pub sheet and location bar |
| `worker/` | The API: snapshot, votes, spam checks, rate limits, daily clean-up |
| `migrations/` | Database structure, applied in order |
| `public/` | Files served as they are: fonts, icon, security headers (`_headers`) |
| `scripts/` | `check-api.mjs`, which tests the vote rules against the local API |
| `seed/` | Scripts and files for loading pubs and beers ([how to use them](seed/README.md)) |

## Running it on your computer

You need Node.js (installed with `brew install node`). Run `npm install` once first.

The first time, create a local secret and a local database:

1. Make a file called `.dev.vars` containing `APP_SECRET=` followed by a long random string (`openssl rand -base64 32` makes one). Git ignores this file.
2. `npm run db:migrate:local` then `npm run db:seed:local`.

Then, in two terminal tabs:

1. `npm run dev:api` runs the API and local database at <http://127.0.0.1:8787>.
2. `npm run dev` runs the site at <http://localhost:5173>, reloading as you edit. It passes `/api` requests to the first tab.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | The site, with live reload |
| `npm run dev:api` | The API and a local copy of the database |
| `npm run check` | Checks the site and API code for mistakes |
| `npm run check:api` | Tests the vote rules against the local API (changes local data) |
| `npm run build` | Builds the site into `dist/` |
| `npm run preview` | Runs everything the way Cloudflare will, at <http://localhost:8787> |
| `npm run db:migrate:local` / `:remote` | Applies database changes locally / to the live database |
| `npm run db:seed:local` / `:remote` | Loads pubs, beers and sample tap lists locally / into the live database |
| `npm run seed:pubs` | Fetches pubs from OpenStreetMap for review |
| `npm run seed:map` | Opens a map of the pubs in the review file |

## Deploying

Pushing to `main` deploys the site and API. Database changes are **not** applied automatically: run `npm run db:migrate:remote` before pushing code that needs them.

## Security

Never commit secrets such as passwords, API tokens or salts. They belong in Cloudflare secrets (or a local `.dev.vars` file, which git ignores). The live API uses one secret, `APP_SECRET`, set with `npx wrangler secret put APP_SECRET`.

What the API stores about visitors: a 32-character device hash per vote (an HMAC of a rotating salt, the IP address and the browser name), cleared after 30 days. IP addresses and locations are never stored, and per-request logging is switched off.

## Credits

Pub names and locations © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the Open Database Licence. Postcode lookups by [postcodes.io](https://postcodes.io) (only when you type a postcode; your device location never leaves your browser). Headings use Bricolage Grotesque under the SIL Open Font License (see `public/fonts/`).

## Licence

To be decided.
