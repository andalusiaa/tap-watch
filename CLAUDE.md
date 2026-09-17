# Tap Watch — notes for Claude Code

The product spec lives outside the repo at `../SPEC.md`. Read it before starting a phase.

## Working rules

- Tristan is self-taught and new to GitHub and Cloudflare. Explain setup steps in plain language and wait for confirmation before creating accounts, repos, databases, buckets, or anything that could cost money.
- Budget is zero. Everything must fit Cloudflare and GitHub free tiers. Flag anything that would cost money or needs a payment method.
- Ask before adding any npm package. Approved so far (dev only): `vite`, `typescript`, `wrangler`.
- Never commit secrets. Use Cloudflare secrets and `.dev.vars` (gitignored).
- Build in the spec's phases (section 13). Finish and demo each phase before starting the next. Pushing to `main` deploys to the live site, so ask before pushing.
- Check current Cloudflare docs rather than assuming; flag anything in the spec that is wrong.

## Stack

- Cloudflare Worker with static assets (`wrangler.jsonc`). Wrangler's `build.command` runs `vite build` into `dist/` before every deploy, so the dashboard needs no build command.
- `public/_headers` sets security headers (strict CSP: no inline scripts or `style` attributes) for static files only. API responses must set their own.
- Worker name in `wrangler.jsonc` must match the Worker name in the Cloudflare dashboard.
- Frontend: plain TypeScript, no framework. `src/ui/dom.ts` `h()` builds elements and refuses `style` attributes.
- `src/rules.ts` (vote state rules) has no browser APIs so the Phase 2 Worker can import it.
- Seed scripts are plain `.mjs` (no `@types/node`); `seed/lib/beers.mjs` `normalise()` must match `src/search.ts`.

## Local preview in the desktop app

The Browser pane's `preview_start` can't launch servers from this folder (macOS blocks access to Documents). Start the server with Bash in the background (`npx vite --port 5173 --strictPort --host 127.0.0.1`), then `preview_start` the `vite` config in `.claude/launch.json`, which only attaches to that URL.
