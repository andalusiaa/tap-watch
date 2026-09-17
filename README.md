# Tap Watch E17

A lightweight, community-led website showing which pubs in Walthamstow (E17) have which beers on tap.

- **Find a beer:** type a beer name and see nearby pubs that pour it, sorted by distance, with how recently that was checked.
- **Check a pub:** tap a pub to see its regular beers, each with its own "last checked" date.

Draught only. No accounts, no tracking cookies, and your location never leaves your device.

## Status

Phase 0 (setup). The site is a placeholder page, live at <https://tap-watch.gage-tristan.workers.dev>.

## How it's built

- **Hosting:** Cloudflare Workers with static assets (free plan). Pushing to `main` on GitHub deploys automatically.
- **Site:** static files in `public/`.
- **Config:** `wrangler.jsonc` tells Cloudflare what to serve.
- Coming in later phases: an API under `/api/*`, a Cloudflare D1 database, and a private R2 bucket for photos waiting to be checked.

## Run it on your computer

For now the site is plain HTML, so any local web server works:

```bash
python3 -m http.server 8787 --directory public
```

Then open <http://localhost:8787>.

## Security

Never commit secrets such as passwords, API tokens or salts. They belong in Cloudflare secrets (or a local `.dev.vars` file, which git ignores).

## Licence

To be decided.
