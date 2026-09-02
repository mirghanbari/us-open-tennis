// Triggers the "Update US Open data" GitHub Actions workflow via
// workflow_dispatch.
//
// Why this exists: GitHub throttles its own `schedule:` cron hard. This repo
// asks for */20 and measured gaps between scheduled runs of 71, 77, 169, 318
// and 302 minutes. workflow_dispatch through the REST API is NOT throttled, so
// this Worker drives the real cadence and the repo's cron stays as a backstop.
//
// What actually goes stale without it: live SCORES are fine either way — the
// browser polls ESPN directly every ~30s. What lags is everything that only the
// ingest produces: the bracket advancing to the next round, suspended status,
// the order of play, and the title odds. Those were sitting hours behind.
//
// Cadence (tennis plays continuously, unlike a football fixture list):
//   - during the daily play window  -> every LIVE_EVERY_MIN minutes (default 10)
//   - outside it                    -> every IDLE_EVERY_MIN minutes (default 60)
// 10 minutes is deliberate rather than 1: a run takes ~1 min and publishes a
// deploy, and nothing it produces changes meaningfully faster than that. A
// 1/min dispatch would just queue runs behind the workflow's concurrency guard.
//
// Required secret:  GH_TOKEN   — fine-grained PAT on mirghanbari/us-open-tennis
//                                with permission: Actions → Read and write.
// Optional secret:  TRIGGER_KEY — if set, the manual GET endpoint needs ?key=.

const DEFAULTS = {
  OWNER: "mirghanbari",
  REPO: "us-open-tennis",
  WORKFLOW: "update-data.yml",
  REF: "main",
  META_URL:
    "https://raw.githubusercontent.com/mirghanbari/us-open-tennis/main/src/data/meta.json",
  LIVE_EVERY_MIN: "10",
  IDLE_EVERY_MIN: "60",
  // Play runs roughly 11:00-01:00 New York time; give it an hour either side.
  PLAY_START_HOUR: "10",
  PLAY_END_HOUR: "2",
};

const cfg = (env, key) => env[key] ?? DEFAULTS[key];

async function dispatch(env) {
  if (!env.GH_TOKEN) throw new Error("GH_TOKEN secret is not set");
  const owner = cfg(env, "OWNER");
  const repo = cfg(env, "REPO");
  const workflow = cfg(env, "WORKFLOW");
  const ref = cfg(env, "REF");

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GH_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "uso-data-trigger",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref }),
    }
  );
  if (res.status !== 204) {
    throw new Error(`dispatch failed: ${res.status} ${await res.text()}`);
  }
  return `dispatched ${workflow} on ${owner}/${repo}@${ref}`;
}

/** Hour of day in New York, whatever the Worker's own timezone is. */
function nyHour(now) {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hour12: false,
    }).format(new Date(now))
  );
}

/** YYYY-MM-DD in New York. */
function nyDate(now) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(
    new Date(now)
  );
}

/**
 * Is the tournament on, and is it within the day's play window? The tournament
 * window comes from the published meta.json so the Worker doesn't need
 * redeploying when the dates move; if that fetch fails we assume it IS on, so a
 * transient error makes us refresh too often rather than go silent.
 */
async function isPlayOn(env, now) {
  const startHour = Number(cfg(env, "PLAY_START_HOUR"));
  const endHour = Number(cfg(env, "PLAY_END_HOUR"));
  const h = nyHour(now);
  const inWindow = h >= startHour || h <= endHour;
  if (!inWindow) return { on: false, reason: `outside play window (NY hour ${h})` };

  try {
    const res = await fetch(cfg(env, "META_URL"), {
      headers: { "User-Agent": "uso-data-trigger" },
      cf: { cacheTtl: 600 },
    });
    if (!res.ok) throw new Error(`meta ${res.status}`);
    const meta = await res.json();
    const today = nyDate(now);
    if (meta.startDate && today < meta.startDate) {
      return { on: false, reason: `tournament starts ${meta.startDate}` };
    }
    if (meta.endDate && today > meta.endDate) {
      return { on: false, reason: `tournament ended ${meta.endDate}` };
    }
    return { on: true, reason: `play window (NY hour ${h})` };
  } catch (err) {
    return { on: true, reason: `meta check failed (${err.message}); assuming play` };
  }
}

async function decide(env, now) {
  const { on, reason } = await isPlayOn(env, now);
  const every = Number(cfg(env, on ? "LIVE_EVERY_MIN" : "IDLE_EVERY_MIN"));
  const minute = new Date(now).getUTCMinutes();
  return { on, dispatch: minute % every === 0, reason: `${reason}, min=${minute}` };
}

export default {
  // Per-minute cron heartbeat; the decision above throttles actual dispatches.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        const now = event.scheduledTime ?? Date.now();
        const d = await decide(env, now);
        if (!d.dispatch) {
          console.log(`skip — ${d.reason}`);
          return;
        }
        try {
          console.log(`${d.reason} → ${await dispatch(env)}`);
        } catch (err) {
          console.error(err.message);
        }
      })()
    );
  },

  /**
   * Manual endpoint, READ-ONLY unless authenticated.
   *
   * The workers.dev URL is public, and forcing a dispatch is an unauthenticated
   * write against the repo — someone who finds the URL could burn Actions
   * minutes and churn deploys. So a plain GET only ever reports the decision.
   * Forcing an actual dispatch requires ?key= matching the TRIGGER_KEY secret,
   * and is refused outright when that secret isn't set.
   *
   * The cron path is unaffected: `scheduled` dispatches on its own schedule.
   */
  async fetch(request, env) {
    const params = new URL(request.url).searchParams;
    const d = await decide(env, Date.now());
    const status = `playOn=${d.on} wouldDispatch=${d.dispatch} (${d.reason})\n`;

    if (params.get("force") !== "1") return new Response(status);

    if (!env.TRIGGER_KEY) {
      return new Response(
        "forcing a dispatch needs the TRIGGER_KEY secret set:\n" +
          "  npx wrangler secret put TRIGGER_KEY\n",
        { status: 403 }
      );
    }
    if (params.get("key") !== env.TRIGGER_KEY) {
      return new Response("not found\n", { status: 404 });
    }
    try {
      return new Response(`${await dispatch(env)} [${d.reason}]\n`);
    } catch (err) {
      return new Response(`${err.message}\n`, { status: 502 });
    }
  },
};
