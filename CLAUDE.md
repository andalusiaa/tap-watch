# Tap Watch — notes for Claude Code

The product spec lives outside the repo at `../SPEC.md`. Read it before starting a phase.

## Working rules

- Tristan is self-taught and new to GitHub and Cloudflare. Explain setup steps in plain language and wait for confirmation before creating accounts, repos, databases, buckets, or anything that could cost money.
- Budget is zero. Everything must fit Cloudflare and GitHub free tiers. Flag anything that would cost money or needs a payment method.
- Ask before adding any npm package. Approved so far: `vite`, `typescript`, `wrangler` (dev only). `maplibre-gl` (runtime, loaded only when the map opens). `pmtiles` was approved but isn't needed. The go-pmtiles CLI lives in `seed/raw/tools/` (gitignored).
- Never commit secrets. Use Cloudflare secrets and `.dev.vars` (gitignored).
- Build in the spec's phases (section 13). Finish and demo each phase before starting the next. Pushing to `main` deploys to the live site, so ask before pushing.
- Check current Cloudflare docs rather than assuming; flag anything in the spec that is wrong.

## Changes Tristan has made to the spec

These override `../SPEC.md`:

- **Typeface:** Bricolage Grotesque (open question 1 closed). Fraunces removed.
- **No "Alcohol-free near me" shortcut and no "Alcohol-free only" filter** (removed 2026-09-17: too prominent). Alcohol-free beers are just part of the beer search, labelled, and typing "alcohol free", "0.0", "zero" etc. lists them. The pub sheet still groups them separately.
- **Freshness colours** (2026-09-18): green = checked within 30 days, amber = within 120 days, grey after that (`src/config.ts`). The map key text is generated from those values.
- **Photo reports carry up to 4 photos**, and after sending a photo or suggestion the form offers to send another.
- **Admin can delete a listing for good** (and its votes), as well as mark it Gone (hidden, restorable). Deleting asks for confirmation.
- **Phase 4 closed on 2026-09-18.** Moved to Phase 5: pubs/operators editing on the admin page, the switch to clear sample tap lists (`areas.is_sample` to 0, delete sample listings; needed before walkaround data), and operator core ranges.
- **Gluten-free filter:** wanted in a future phase (after Phase 5 unless Tristan says otherwise). Not designed yet; it will need a gluten-free flag per beer and a spreadsheet column.
- **Location is asked for when the user searches** (not only via a "Use my location" button), and distances are measured from where they are at that moment. A fix under 60 seconds old is reused. Postcode entry is the fallback. If permission was already granted, location is used on page load.

## Stack

- Cloudflare Worker with static assets (`wrangler.jsonc`). Wrangler's `build.command` runs `vite build` into `dist/` before every deploy, so the dashboard needs no build command. `run_worker_first: ["/api/*"]` sends API calls to `worker/index.ts`.
- D1 database `tap-watch` (binding `DB`). Migrations in `migrations/` are NOT applied by deploys: run `npm run db:migrate:remote` before pushing code that needs them. Wrangler is logged in to Tristan's account on this Mac.
- Secret `APP_SECRET` (Cloudflare secret; `.dev.vars` locally) signs page tokens and keys device hashes. Device-hash salt rotates in the `device_salts` table.
- Snapshot is cached in `snapshot_cache` (rebuilt at most once a minute after changes) because the Cache API does nothing on `*.workers.dev`. Writes must bump the version via `invalidateSnapshot()` in the same batch.
- Per-request (invocation) logs are off for privacy. Never `console.log` request details or IPs.
- `npm run check:api` tests vote rules against `npm run dev:api`; the local scheduled-event URL is `/cdn-cgi/handler/scheduled`.
- Map (Phase 3): `src/ui/map.ts` is dynamically imported, so MapLibre never loads with the first page. Workers static assets ignore HTTP Range requests (tested 2026-09-17, local and live), so a single .pmtiles file can't be served; `npm run map:build` exports individual tiles to `public/map/tiles/<area>-<build>/`, uncompressed. `_headers` labels them `application/x-protobuf` so Cloudflare compresses them (pre-gzipped files with Content-Encoding got double-compressed). The `pmtiles` npm package is therefore not used.
- Map glyphs are self-hosted Noto Sans ranges in `public/map/fonts/` (only 0-255, 256-511, 8192-8447). Add ranges if labels need other characters.
- Photos (Phase 4): public `POST /api/report` takes 1-4 JPEGs (metadata stripped again server-side in `worker/jpeg.ts`) and stores each in KV binding `PHOTOS` with a 31-day TTL; `photo_report_images` rows point to them (migration 0003 moved them out of `photo_reports`). Approve/reject deletes it; the cron expires unchecked ones after 30 days. Chosen instead of R2 because R2 needs a card.
- Admin auth: secret `ADMIN_PASSWORD` (Tristan sets it himself; never ask for or type it). Login sets an HttpOnly, Secure, SameSite=Strict cookie scoped to `/api/admin`, signed with APP_SECRET and the password fingerprint. Admin writes also require same origin. Don't enter admin passwords in the browser pane; to test admin UI, stub `fetch` in the page and rely on `npm run check:api` for the server.
- All public writes go through `guardPublicWrite()` (honeypot, page token, edge limiter, daily budget, device hash) and `limitPerDevice()`.
- Beer list: Tristan edits it as a spreadsheet. `npm run beers:export` reads the LIVE database (so admin-added beers are kept) into `seed/out/beer-list.csv`; `npm run beers:import -- <file>` validates it into `seed/beers.json`; `npm run db:beers:remote` loads only beers. Never run `db:seed:remote` or `db:beers:remote` from a `beers.json` that hasn't come from an export: beers missing from it are hidden.
- `worker/worker-configuration.d.ts` is generated by `wrangler types` (run by `npm run check`) and gitignored. Don't add `@types/node` or `@cloudflare/workers-types`.
- `public/_headers` sets security headers (strict CSP: no inline scripts or `style` attributes) for static files only. API responses must set their own.
- Worker name in `wrangler.jsonc` must match the Worker name in the Cloudflare dashboard.
- Frontend: plain TypeScript, no framework. `src/ui/dom.ts` `h()` builds elements and refuses `style` attributes.
- `src/rules.ts` (vote state rules) has no browser APIs so the Phase 2 Worker can import it.
- Seed scripts are plain `.mjs` (no `@types/node`); `seed/lib/beers.mjs` `normalise()` must match `src/search.ts`.

## Local preview in the desktop app

The Browser pane's `preview_start` can't launch servers from this folder (macOS blocks access to Documents). Start the server with Bash in the background (`npx vite --port 5173 --strictPort --host 127.0.0.1`), then `preview_start` the `vite` config in `.claude/launch.json`, which only attaches to that URL.
