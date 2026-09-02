# uso-data-trigger

A tiny Cloudflare Worker that fires the **Update US Open data** GitHub Actions
workflow via `workflow_dispatch`.

## Why

GitHub throttles its own `schedule:` cron. This repo's workflow asks for `*/20`;
measured gaps between actual scheduled runs were **71, 77, 169, 318 and 302
minutes**. `workflow_dispatch` through the REST API is **not** throttled, so this
Worker drives the real cadence and the repo's `schedule:` stays a backstop.

**This does not affect live scores.** Those go browser → ESPN directly every ~30
seconds and never touch Actions. What was going stale is everything only the
ingest produces: the bracket advancing to the next round, suspended matches, the
order of play, and the title odds — all of which were sitting hours behind.

## Cadence

Tennis plays continuously rather than at discrete kickoffs, so the Worker uses a
time window rather than per-match logic:

| When | Dispatch |
| --- | --- |
| Daily play window (10:00–02:00 New York), during the tournament | every 10 min |
| Otherwise | every 60 min |

10 minutes rather than 1 is deliberate: a run takes ~1 minute and publishes a
deploy, and nothing it produces changes faster than that. A 1/min dispatch would
just queue runs behind the workflow's concurrency guard.

The tournament's date range is read from the deployed `meta.json`, so the Worker
does not need redeploying when dates change. If that fetch fails it assumes play
IS on — erring toward refreshing too often rather than going silent.

## One-time setup

1. **Create a fine-grained PAT** — GitHub → Settings → Developer settings →
   Fine-grained tokens → Generate:
   - **Repository access:** Only select repositories → `us-open-tennis`
   - **Permissions:** Repository → **Actions: Read and write**
   - Expiration: just past the tournament.

2. **Install and log in:**
   ```bash
   cd cron-trigger
   npm install
   npx wrangler login
   ```

3. **Store the token as an encrypted secret** (never committed):
   ```bash
   npx wrangler secret put GH_TOKEN
   # paste the PAT when prompted
   ```
   Optionally, to allow forcing a run over HTTP:
   ```bash
   npx wrangler secret put TRIGGER_KEY
   ```
   Without it the public endpoint is read-only, which is the safe default —
   see below.

4. **Deploy:**
   ```bash
   npx wrangler deploy
   ```

## Checking it

```bash
curl "https://uso-data-trigger.<your-subdomain>.workers.dev/"
# playOn=true wouldDispatch=false (play window (NY hour 14), min=37)

npx wrangler tail        # live logs
```

**The HTTP endpoint is read-only.** The workers.dev URL is public, and forcing a
dispatch would be an unauthenticated write against the repo — enough for a
passer-by to burn Actions minutes and churn deploys. So a plain GET only reports
the decision. To force a run you need the `TRIGGER_KEY` secret set, then:

```bash
curl "https://uso-data-trigger.<your-subdomain>.workers.dev/?force=1&key=<value>"
```

The cron path is unaffected either way — it dispatches on its own schedule
regardless of whether TRIGGER_KEY exists.

## Turning it off

When the tournament ends the Worker stops dispatching on its own (it compares
today against `meta.json`'s `endDate`), so it is safe to leave running. To remove
it entirely: `npx wrangler delete`.
