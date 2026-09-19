# Tap Watch E17

A lightweight, community-led website showing which pubs in Walthamstow (E17) have which beers on tap.

- **Find a beer:** type a beer name and see nearby pubs that pour it, sorted by distance, with how recently that was checked.
- **Check a pub:** tap a pub to see its regular beers, each with its own "last checked" date.

Draught only. No accounts, no tracking cookies, and your location never leaves your device.

Live at <https://tap-watch.gage-tristan.workers.dev>.

## Status

Phase 4 (moderation). Visitors can vote, send up to 4 photos of the taps at a time and suggest beers. A private admin page (`/admin/`) is for checking photos and suggestions and editing each pub's tap list. **The tap lists are still made up** and the site says so.

**Phase 4 is complete. Phase 5 (polish and launch) is mostly built:**

- Admin Pubs tab: add or change pubs and operators, mark pubs closed, and turn the test banner off.
- Admin "Add a beer" works like the public "Submit a beer" form.
- Dark mode from sunset to sunrise in Walthamstow, with an Auto / Light / Dark choice in the footer.
- How it works (`/about/`) and Privacy (`/privacy/`) pages.
- Long-term caching for built files, and a security review (below).

Still to do before launch:

1. Tristan's walkaround data.
2. A Lighthouse check on the live site (target 95+ for speed and accessibility on a phone).
3. Turn the test banner off on the admin Pubs tab, and add `hidden` to the banner in `index.html`. It starts visible so the page doesn't jump while loading.
4. Remove the `noindex` tag from `index.html` so search engines can list the site.
5. Add contact details to the Privacy page. Tristan has put this on hold for now.

Operator core ranges are in Phase 5 but lowest priority, because most E17 pubs are independents.

### Ideas for after launch

Noted, not designed yet:

- **Gluten-free filter.** A gluten-free yes/no per beer, filled in as a spreadsheet column.
- **Recognising contributors** without accounts or tracking. For example, an optional nickname kept on the device and sent with votes and submissions, feeding a leaderboard or badges. It must stay opt-in and store nothing that identifies a person.
- **A beer index.** Which drinks are most searched for and most poured across E17, which pubs could use to understand drinkers. Search counts would be totals per beer per day, never linked to a person or device.
- **Tap wars.** Fun comparison maps, such as Guinness vs Murphy's vs Beamish, or Camden Hells vs Neck Oil, with pins coloured by which one each pub pours.

## How it's built

- **Hosting:** Cloudflare Workers with static assets (free plan). Pushing to `main` on GitHub deploys automatically. Wrangler runs the build first.
- **Site:** plain TypeScript and CSS, bundled by Vite. No UI framework.
- **API:** a Cloudflare Worker (`worker/`) answers `/api/snapshot` and `/api/vote`.
- **Database:** Cloudflare D1, structure in `migrations/`, data loaded from [`seed/`](seed/README.md).
- **Photos:** waiting photos are kept in Cloudflare Workers KV (`tap-watch-photos`, free plan, no card needed) and deleted once checked, or after 30 days.
- **Admin:** `/admin/`, signed in with a password stored as a Cloudflare secret. A sign-in lasts 30 days.
- **Clean-up:** a daily scheduled job clears device hashes after 30 days and deletes old rate-limit counters.
- **Map:** MapLibre (loaded only when someone opens the map) drawing an OpenStreetMap basemap from Protomaps. The map tiles are ordinary files in `public/map/`, so no map company sees visitors.
- Coming in later phases: photo reports, suggestions and the admin page.

## Folders

| Path | What's in it |
|---|---|
| `index.html`, `404.html` | The pages |
| `src/` | TypeScript and CSS for the site |
| `src/ui/` | The search box, results list, pub sheet, location bar and map |
| `public/map/` | Map tiles (`tiles/`), label fonts (`fonts/`) and `e17.json`, made by `npm run map:build` |
| `admin/`, `src/admin/` | The admin page: sign-in, photos and suggestions to check, tap list editor |
| `worker/` | The API: snapshot, votes, photo reports, suggestions, admin, spam checks, rate limits, daily clean-up |
| `migrations/` | Database structure, applied in order |
| `public/` | Files served as they are: fonts, icon, security headers (`_headers`) |
| `scripts/` | `check-api.mjs`, which tests the vote rules against the local API |
| `seed/` | Scripts and files for loading pubs and beers ([how to use them](seed/README.md)) |

## Running it on your computer

You need Node.js (installed with `brew install node`). Run `npm install` once first.

The first time, create a local secret and a local database:

1. Make a file called `.dev.vars` (git ignores it) with two lines: `APP_SECRET=` followed by a long random string (`openssl rand -base64 32` makes one), and `ADMIN_PASSWORD=` followed by a password for the local admin page.
2. `npm run db:reset:local` creates a fresh local database with the sample data.

Then, in two terminal tabs:

1. `npm run dev:api` runs the API and local database at <http://127.0.0.1:8787>.
2. `npm run dev` runs the site at <http://localhost:5173>, reloading as you edit. It passes `/api` requests to the first tab.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | The site, with live reload |
| `npm run dev:api` | The API and a local copy of the database |
| `npm run check` | Checks the site and API code for mistakes |
| `npm run check:api` | Tests votes, photos, suggestions, admin and clean-up against the local API (needs a fresh local database) |
| `npm run db:reset:local` | Deletes the local database and creates a fresh one (stop `dev:api` first) |
| `npm run build` | Builds the site into `dist/` |
| `npm run preview` | Runs everything the way Cloudflare will, at <http://localhost:8787> |
| `npm run db:migrate:local` / `:remote` | Applies database changes locally / to the live database |
| `npm run db:seed:local` / `:remote` | Loads pubs, beers and sample tap lists locally / into the live database |
| `npm run seed:pubs` | Fetches pubs from OpenStreetMap for review |
| `npm run seed:map` | Opens a map of the pubs in the review file |
| `npm run beers:export` | Saves the live beer list as a spreadsheet: `seed/out/beer-list.csv` |
| `npm run beers:import -- <file>` | Checks an edited beer spreadsheet and saves it as `seed/beers.json` |
| `npm run db:beers:remote` | Loads the beer list into the live database (pubs and tap lists are left alone) |
| `npm run map:build` | Rebuilds the map tiles from the latest OpenStreetMap data (needs the pmtiles tool, see `seed/build-basemap.mjs`) |

## Deploying

Pushing to `main` deploys the site and API. Database changes are **not** applied automatically: run `npm run db:migrate:remote` before pushing code that needs them.

## Security

Never commit secrets such as passwords, API tokens or salts. They belong in Cloudflare secrets (or a local `.dev.vars` file, which git ignores). The live API uses two secrets: `APP_SECRET` (`npx wrangler secret put APP_SECRET`) and `ADMIN_PASSWORD`, the admin page password (`npx wrangler secret put ADMIN_PASSWORD`, at least 12 characters). Changing the password signs out every admin session.

Security review (2026-09-19, Phase 5):

- **Admin access:**
  - Everything under `/api/admin/` needs the signed session cookie (HttpOnly, Secure, SameSite=Strict).
  - Every admin change also needs a same-origin request.
  - Sign-in is rate-limited and locks for the day after 100 wrong passwords.
- **Public writes:** votes, photos and beer submissions all go through the honeypot, page-token timing, edge rate limiter, daily write budget and per-device limits.
- **Photo uploads:**
  - Size is checked before the body is read.
  - Each file must be a real JPEG, with its metadata stripped on the server.
- **Headers:**
  - Static pages send a strict Content Security Policy (no inline scripts or styles) and can't be framed.
  - Pages can't use the camera or microphone.
  - HTTPS is enforced, because the whole `.dev` domain is HSTS-preloaded.
- **Dependencies and secrets:** `npm audit` reports 0 vulnerabilities. Git history contains no secrets or `.dev.vars` files, which matters because the repo is public.
- **Biggest remaining risk: the accounts.** Keep two-factor authentication on for Cloudflare and GitHub, and use a unique admin password.

What the API stores about visitors: a 32-character device hash per vote, photo report and suggestion (an HMAC of a rotating salt, the IP address and the browser name), cleared after 30 days. Photos are shrunk and re-encoded in the browser, which removes location data; the server also strips any metadata. Photos are only visible to the admin and are deleted once checked, or after 30 days. IP addresses and locations are never stored, and per-request logging is switched off.

## Credits

Pub names and locations © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the Open Database Licence. Map data from [Protomaps](https://protomaps.com), built from OpenStreetMap. Map labels use Noto Sans (SIL Open Font License). Postcode lookups by [postcodes.io](https://postcodes.io) (only when you type a postcode; your device location never leaves your browser). Headings use Bricolage Grotesque under the SIL Open Font License (see `public/fonts/`).

## Licence

To be decided.
