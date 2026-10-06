# storm-sources

The content sources behind [storm](https://stormd.site). Each **extension** teaches
storm how to read one site; the site downloads them from this repo, the way Mihon
installs extensions.

```
packages/sdk     the contract an extension is written against (types and helpers)
packages/host    what runs extensions: requests, parsing, caching, checks, loading
extensions/      one folder per site, grouped by app
scripts/         build-repo, keys, try
```

## How a source works

An extension exports `defineExtension({ pkg, name, version, app, sources })`. Each
source declares what it can do — its **listings** (popular, latest…), its own
**filters** (genres, status, type, sort…), **settings** an admin can change, and how
its images must be loaded — then implements what its app needs:

| app | source | implements |
| --- | --- | --- |
| `mangasto` | `defineSource` | `list`, `search`, `manga`, `chapters`, `pages` |
| `anisto` | `defineAnimeSource` | `list`, `search`, `details`, `episodes`, `servers` |
| `movisto` | `defineFilmSource` | `list`, `search`, `details` (with a series' seasons), `episodes`, `servers` |
| `novelsto` | `defineNovelSource` | `list`, `search`, `details`, `chapters`, `content` |
| `booksto` | `defineBookSource` | `list`, `search`, `details` (with its files), and `sections` + `content` when the text can be read on storm |

`servers` answers where something plays: a page to frame, an HLS playlist or a
video file, and which are downloads. `content` answers text as blocks (paragraphs,
headings, quotes, images), never HTML; `htmlToBlocks` turns a site's markup into them.

Extensions never fetch or parse on their own. The host hands them `ctx`:

| `ctx.http`  | requests with timeouts, retries, the source's rate limit, Cloudflare detection and caching; `session()` keeps a site's cookies across requests |
| `ctx.html`  | an HTML parser (`one`, `all`, `text`, `attr`, `href`, `without`) |
| `ctx.cache` | a per-source cache |
| `ctx.settings` | the admin's settings for this source |

The SDK's helpers read what sites print in English and Arabic: `chapterNumber`,
`seasonNumber` ("الموسم التاسع", "S09"), `parseDate` ("منذ يومين", "3 days ago",
"15 سبتمبر 2026"), `minutes` ("2h 46m", "120 دقيقة"), `year`, `status`, `mangaType`,
`animeType` and `genreKey`, which maps a site's genre names onto storm's own list.

Everything an extension returns is checked by the host. A missing title, a page
without an address or a chapter without an id becomes a `changed` error naming
what broke, which is how storm notices a site changed its layout.

## Adding a source

1. Copy an extension of the same app (`extensions/<app>/<site>`) to a new folder and give it a new `pkg`.
2. Try it against the live site:
   `bun scripts/try.ts extensions/<app>/<name> <source id> [item id] [search]`
3. Write `test/<name>.test.ts` with `contractTests` and record the answers:
   `bun run record`
4. Open a pull request. CI replays the recordings, so tests never depend on the
   site being up.

Change an extension? Bump its `version` — the build refuses changed code under an
old version number, because sites only update when the version moves.

## Publishing and trust

Every push to `main` runs the tests, bundles each extension into one file, and
publishes `index.json`, its Ed25519 signature `index.json.sig` and the bundles to
the `repo` branch. storm only loads an index signed by a key it trusts, and only
bundles whose SHA-256 matches the index.

- `bun run keys` makes a key pair. The private key is the `STORM_SIGNING_KEY`
  repository secret; the public key goes in storm's admin.
- A daily workflow runs every source against the live sites and opens an issue
  when one fails.

## Tests

```
bun test                 replay recorded answers (fast, offline)
bun run test:live        hit the real sites
bun run record           hit the real sites and save new recordings
```
