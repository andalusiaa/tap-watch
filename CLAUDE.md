# Tap Watch — notes for Claude Code

The product spec lives outside the repo at `../SPEC.md`. Read it before starting a phase.

## Working rules

- Tristan is self-taught and new to GitHub and Cloudflare. Explain setup steps in plain language and wait for confirmation before creating accounts, repos, databases, buckets, or anything that could cost money.
- Budget is zero. Everything must fit Cloudflare and GitHub free tiers. Flag anything that would cost money or needs a payment method.
- Ask before adding any npm package. Prefer platform APIs and plain TypeScript.
- Never commit secrets. Use Cloudflare secrets and `.dev.vars` (gitignored).
- Build in the spec's phases (section 13). Finish and demo each phase before starting the next.
- Check current Cloudflare docs rather than assuming; flag anything in the spec that is wrong.

## Stack

- Cloudflare Worker with static assets (`wrangler.jsonc`), served from `public/`. Cloudflare recommends Workers over Pages for new projects.
- `public/_headers` sets security headers for static files only. API responses must set their own.
- Worker name in `wrangler.jsonc` must match the Worker name in the Cloudflare dashboard.
