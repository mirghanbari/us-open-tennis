# US Open 2026 Dashboard

A React + TypeScript + Vite dashboard for the 2026 US Open — draws, live scores,
order of play, court board, players and stats. **All data is real**, pulled from
the official US Open feed and ESPN, both keyless.

Sibling project to [`dashboards/world-cup`](https://github.com/mirghanbari/dashboards/tree/main/world-cup),
which it borrows its structure from.

## Pages

| Page | What it shows |
| --- | --- |
| **Overview** (`/`) | Live matches, latest results, seed carnage, marathon watch |
| **Courts** (`/courts`) | All 17 courts — what's on each now, and what follows |
| **Schedule** (`/schedule`) | Order of play by tournament day, with start times and TV |
| **Draws** (`/draw/:event`) | Full bracket per event, plus the prize-money table |
| **Matches** (`/matches`) | Every match, filterable by event and state |
| **Match detail** (`/matches/:id`) | Set-by-set score, route into the match, who the winner meets |
| **Players** (`/players`) | Everyone in the published draws, sortable |
| **Player detail** (`/players/:id`) | Bio, ranking, record here, prize money, matches |
| **Stats** (`/stats`) | Serve leaders, seeds alive/out, prize money, longest matches, nations, upsets, retirements |
| **My players** (`/favorites`) | Starred players with their live or next match |

Routing uses `HashRouter` so deep links work on GitHub Pages without server config.

## Run locally

```bash
npm install
npm run dev          # http://localhost:5173/us-open-tennis/
```

Other scripts:

```bash
npm run build          # type-check + production build into dist/
npm run ingest         # refresh everything, in dependency order
npm run ingest:usopen  # official draws (run first — the others enrich its output)
npm run ingest:espn    # TV listings, start times, rankings, bios
npm run ingest:h2h     # head-to-head for upcoming matches
npm run ingest:tml     # serve statistics
```

Weather is **not** ingested: it changes every few minutes, so committing it would
churn `src/data` on every CI run and trigger a redeploy even when no match data
moved. Open-Meteo is CORS-enabled, so the browser fetches it directly.

## Where the data comes from

Two sources, with a deliberate division of labour.

| Source | Supplies | CORS |
| --- | --- | --- |
| `www.usopen.org/en_US/scores/feeds/{year}/draws/{MS,WS,MD,WD,XD}.json` | Bracket structure, seeds, entry status, courts, per-round prize money, final scores, set durations, upset flags | No |
| `site.api.espn.com/.../tennis/{atp,wta}/scoreboard` | Live scores, **scheduled start times**, TV/streaming carriers | Yes |
| `site.api.espn.com/.../tennis/{atp,wta}/rankings` | ATP/WTA top 150, points, trend | Yes |
| `sports.core.api.espn.com/.../athletes/{id}` | Bios: hand, height, DOB, birthplace | Yes |
| `www.usopen.org/.../stats/head2head/{match_id}.json` | Head-to-head records, keyed by the same match_id as the draws | No |
| `stats.tennismylife.org/data/*_ongoing_tourneys.csv` | **Per-match serve statistics** — aces, double faults, first/second serve, break points | No |
| `api.open-meteo.com` | Conditions at Flushing Meadows | Yes |

Two things about this are worth knowing before changing anything:

**Use `www.usopen.org`, never `ashe.usopen.org`.** Both serve the same paths, but
`ashe` returns a *stale* draw — zero completed matches and entrants from a
different draw entirely. It fails silently and would poison the whole dataset.

**The bracket comes from the `match_id`.** Ids are
`{eventDigit}{roundIndex}{2-digit slot}` — `1101` is men's singles round 1 slot 1,
`4401` is women's doubles round 4 (its quarter-final) slot 1. The round digit is
1-indexed *within that draw*, so it already accounts for draw size. Round *r*
slot *n* advances into round *r+1* slot `ceil(n/2)`. ESPN cannot substitute here:
it has no bracket endpoint and its competition ids are scheduling order, not draw
order.

### Live scores go browser → ESPN directly

The World Cup dashboard polled a slim `live.json` that a GitHub Action
regenerated and redeployed. That suits four matches a day; the US Open plays up
to 17 courts for 12+ hours, so that loop would run essentially nonstop and still
lag a deploy cycle behind.

Instead `src/data/live.ts` fetches ESPN from the client. ESPN sends
`access-control-allow-origin: *` with `cache-control: max-age=9`, and the whole
five-draw payload is ~99KB gzipped. So live scores are **faster** (~10s vs ~2min)
and **cheaper** (no Actions minutes, no redeploy per score change). The committed
`matches.json` is the fallback: if ESPN is unreachable the page still renders the
last ingested state.

The ATP and WTA scoreboards return *identical* payloads for a Slam (all five
draws under both, verified 625 competitions each), so one request covers
everything — fetching both would double-index every competition.

### Joining the sources

There is no shared player id anywhere, so everything is joined on names,
normalized for diacritics and punctuation. Three wrinkles the joins handle:

- The feeds disagree on given/family name order for some players — the draw says
  "Yunchaokete Bu" where ESPN says "Bu Yunchaokete" — so name tokens are sorted
  before comparing.
- ESPN uses fuller or different forms ("Chak Lam Coleman Wong" vs "Coleman
  Wong", "Catherine McNally" vs "Caty McNally"), caught by an unambiguous
  surname-pair fallback.
- Tennismylife transliterates differently again ("Alexander" vs "Aleksandr"
  Shevchenko), caught by the same fallback.

Tennismylife rows are joined on the unordered **player pair** rather than round
codes — a given pair meets at most once in a tournament, so the pair alone is
unambiguous and no round-vocabulary mapping is needed. Its winner/loser columns
are then re-oriented onto the draw's team1/team2 order (verified in both
directions against the raw feed).

Current join rates: **ESPN 179/179** singles matches with both sides known;
**Tennismylife 113/113** published US Open rows. Doubles join to ESPN only once
it populates that draw (every doubles slot reads `TBD` until play starts).

## What is NOT available for free

The UI labels provenance rather than inventing values. Known gaps:

- **ESPN publishes no per-match tennis statistics** (`statsSource: none`) and no
  odds. Serve stats come from [Tennismylife](https://stats.tennismylife.org/tennis-match-database),
  which mirrors the Sackmann schema. (Jeff Sackmann's own `tennis_atp`/`tennis_wta`
  repos 404 as of Sept 2026.) It updates **roughly daily, not live**, so a match
  that finished in the last few hours usually has no stats yet — the UI says so
  rather than showing blanks. Its publisher also notes WTA data is less reliable
  than ATP, which the match page repeats where relevant.
- **No live serve statistics exist in any free source.** In-progress matches show
  scores only.
- **Men's doubles** (`MD.json`) is not published yet; the ingest skips it and
  picks it up automatically once it appears.
- ESPN's season stats for a player are only W/L, titles and prize money.

## Refreshing the data

`.github/workflows/update-data.yml` runs `npm run ingest` every 20 minutes during
the tournament and commits any changed JSON, which triggers a redeploy. It does
**not** poll every minute — it doesn't need to, because live scores come from the
browser.

## Deploying

Live at **https://mirghanbari.github.io/us-open-tennis/**

`.github/workflows/deploy.yml` builds and publishes `dist/` to GitHub Pages on
every push to `main` and after each successful data refresh.

One-time setup on a fresh repo: Pages has to be turned on by an owner, either via
Settings → Pages → Source → **GitHub Actions**, or:

```bash
gh api -X POST repos/{owner}/{repo}/pages -f build_type=workflow
```

The workflow cannot do this itself — `configure-pages`'s `enablement` option
needs repo-admin rights the `GITHUB_TOKEN` doesn't carry. The repo must also be
public for Pages on the free tier.

Vite's `base` is `"/us-open-tennis/"`, matching the project-page URL.
