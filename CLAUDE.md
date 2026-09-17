# Tap Watch — notes for Claude Code

The product spec lives outside the repo at `../SPEC.md`. Read it before starting a phase.

## Working rules

- Tristan is self-taught and new to GitHub and Cloudflare. Explain setup steps in plain language and wait for confirmation before creating accounts, repos, databases, buckets, or anything that could cost money.
- Budget is zero. Everything must fit Cloudflare and GitHub free tiers. Flag anything that would cost money or needs a payment method.
- Ask before adding any npm package. Approved so far: `vite`, `typescript`, `wrangler` (dev only). Approved for the Phase 3 map: `maplibre-gl` and `pmtiles` (loaded only when the map opens), plus a one-off download of the go-pmtiles CLI to cut the E17 basemap extract.
- Never commit secrets. Use Cloudflare secrets and `.dev.vars` (gitignored).
- Build in the spec's phases (section 13). Finish and demo each phase before starting the next. Pushing to `main` deploys to the live site, so ask before pushing.
- Check current Cloudflare docs rather than assuming; flag anything in the spec that is wrong.

## Changes Tristan has made to the spec

These override `../SPEC.md`:

- **Typeface:** Bricolage Grotesque (open question 1 closed). Fraunces removed.
- **No "Alcohol-free near me" shortcut and no "Alcohol-free only" filter** (removed 2026-09-17: too prominent). Alcohol-free beers are just part of the beer search, labelled, and typing "alcohol free", "0.0", "zero" etc. lists them. The pub sheet still groups them separately.
- **Location is asked for when the user searches** (not only via a "Use my location" button), and distances are measured from where they are at that moment. A fix under 60 seconds old is reused. Postcode entry is the fallback. If permission was already granted, location is used on page load.

## Stack

- Cloudflare Worker with static assets (`wrangler.jsonc`). Wrangler's `build.command` runs `vite build` into `dist/` before every deploy, so the dashboard needs no build command.
- `public/_headers` sets security headers (strict CSP: no inline scripts or `style` attributes) for static files only. API responses must set their own.
- Worker name in `wrangler.jsonc` must match the Worker name in the Cloudflare dashboard.
- Frontend: plain TypeScript, no framework. `src/ui/dom.ts` `h()` builds elements and refuses `style` attributes.
- `src/rules.ts` (vote state rules) has no browser APIs so the Phase 2 Worker can import it.
- Seed scripts are plain `.mjs` (no `@types/node`); `seed/lib/beers.mjs` `normalise()` must match `src/search.ts`.

## Local preview in the desktop app

The Browser pane's `preview_start` can't launch servers from this folder (macOS blocks access to Documents). Start the server with Bash in the background (`npx vite --port 5173 --strictPort --host 127.0.0.1`), then `preview_start` the `vite` config in `.claude/launch.json`, which only attaches to that URL.
