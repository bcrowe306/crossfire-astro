# crossfireengine.io

The website of the [Crossfire Engine](https://github.com/bcrowe306/crossfire-engine) and
[Editor](https://github.com/bcrowe306/crossfire-editor): a landing page, Download, About,
Contribute, and the documentation (getting started, examples, the editor manual, the engine API
reference). Built with [Astro](https://astro.build) and [Starlight](https://starlight.astro.build),
hosted on Cloudflare Pages. MIT licensed.

## Working on it

The site expects the engine and editor checked out beside it, as in the Crossfire workspace:

```
crossfire_astro/    this repository
odin_sdl_engine/    bcrowe306/crossfire-engine
odin_sdl_editor/    bcrowe306/crossfire-editor
```

(`ENGINE_DIR` and `EDITOR_DIR` point elsewhere.) You need Node 22+ and
[Odin](https://odin-lang.org) (`dev-2026-10`) for the API reference and the example checks.

| Command | What it does |
|---|---|
| `npm install` | Once |
| `npm run docs` | Generates the editor manual and the engine API pages, and the release info, from the checkouts |
| `npm run check:examples` | Type-checks every Odin example in the docs against the engine |
| `npm run dev` | The site at localhost:4321, reloading as you edit |
| `npm run build` | The static site into `dist/` |
| `npm run site` | `docs`, `check:examples` and `build`: what CI runs |

## Where things are

| Path | What |
|---|---|
| `src/pages/` | The hand-built pages: `index.astro` (landing), `download.astro`, `about.astro`, `contribute.astro`, `release.json.ts` |
| `src/layouts/SiteLayout.astro`, `src/styles/site.css` | Their layout and styles |
| `src/content/docs/getting-started/`, `examples/` | Docs written for the site |
| `src/content/docs/manual/`, `api/` | Generated (gitignored): the editor's `docs/manual/` and the engine's doc comments |
| `scripts/` | `sync-manual.mjs`, `build-api.mjs` (with `tools/docgen`, an Odin program), `check-examples.mjs`, `release-info.mjs` |
| `src/styles/theme.css` | The colors and fonts, shared with Starlight |
| `src/components/` | Starlight overrides: the header's site links, the docs footer |
| `public/media/` | The hero video (cut from a screen recording of the editor) |

## Deploying

`.github/workflows/deploy.yml` builds and deploys to Cloudflare Pages (project `crossfire-astro`)
on pushes to main, by hand, from the editor's release workflow (its `website` job calls this
workflow with `workflow_call`, using the editor repository's Cloudflare secrets), and
hourly when the newest editor release isn't the one the live site describes (`/release.json`).
The docs come from the newest editor release and engine tag. Secrets: `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`.

Release files are served from `downloads.crossfireengine.io` (Cloudflare R2, bucket
`crossfire-downloads`), uploaded by the editor's release workflow with `latest.json` beside them;
`scripts/release-info.mjs` reads it, falling back to GitHub's releases.

## Writing examples

Every ```odin block in the docs must compile: `npm run check:examples` checks them. A block
starting with `package` is a complete file; one with top-level declarations goes into a
`package scripts` with the engine imported as `e`; plain statements are wrapped in a procedure
(a `// Given: name: Type` first line declares what they use). ```odin nocheck skips a block.
Blocks on a page share one package, so later blocks can use earlier ones. The full rules are in
`scripts/check-examples.mjs`'s header; `scripts/check-examples-allow.json` lists known failures
(keep it empty: fix the example in its repository instead).
