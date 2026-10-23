# crossfire-astro: crossfireengine.io

The Crossfire website (Astro 7 + Starlight 0.42), deployed to Cloudflare Pages by
`.github/workflows/deploy.yml`. README.md has the commands, layout and deploy flow; read it first.
The workspace's `../starlight/` is a clone of Starlight itself at the same version: its
`docs/src/content/docs/` is the reference for configuration, frontmatter, components and overrides.

## Rules

- **Generated docs aren't edited here.** `src/content/docs/manual/` comes from the editor's
  `docs/manual/` and `src/content/docs/api/` from the engine's doc comments (both gitignored, made
  by `npm run docs`). Fix the source in those repositories; fix the conversion in `scripts/`.
- **Every Odin example compiles** (`npm run check:examples`, run by CI before deploying). Follow
  the block convention in README.md; `odin nocheck` only for code that isn't meant to compile.
- **Every engine file belongs to an API area** (`scripts/api-groups.json`): a new engine file
  needs an entry, or `build-api.mjs` complains.
- **The look:** `src/styles/theme.css` (Starlight's variables and the `--cf-*` palette: the logo's
  fire on near-black, Chakra Petch / Inter / JetBrains Mono, sharp corners and diagonal cuts).
  The hand-built pages are dark only; the docs have a light theme too.
- **Facts on the pages are checked against the repositories** (requirements, versions, file names,
  menu paths). Don't promise what the editor doesn't do.
- **Never screenshot the desktop.** To look at a page, build it and render it with headless
  Chromium (`chromium --headless=new --screenshot=... --window-size=1440,6000 <url>` against
  `python3 -m http.server` in dist/): that renders the site off screen.
- Cloudflare: account `e2ad91408c89e73b99f52c878e489fd7`, zone crossfireengine.io (DNS: apex and
  www CNAME to crossfire-astro.pages.dev, proxied), Pages project `crossfire-astro` (created with
  wrangler 4's `--force`: a classic Pages project, not Workers; **wrangler 4 without `--force` on
  `pages project create` rewrites the project for Workers**: an `@astrojs/cloudflare` adapter, a
  wrangler.jsonc, new npm scripts. The site is static: no adapter, deployed with
  `wrangler pages deploy dist`). R2 bucket `crossfire-downloads`
  at downloads.crossfireengine.io. The credentials are the workspace's `cloudfare.env` (never print
  or commit it) and the repository secrets.
- **Releases: push this site first, then tag the engine and editor.** The editor's release deploys the
  site from main, at the release's docs; a site change the release needs (a new engine file's API
  area in `scripts/api-groups.json`, pages using new API) must already be on main, or the release's
  deploy fails (dev.57 did: names.odin had no area). An area may list a file the current engine tag
  doesn't have yet (a warning, not an error).
